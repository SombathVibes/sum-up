// Button presses from the /menu and /sync keyboards, in groups and in a bot
// admin's private-chat panel.

import { api, BotApiError, InputFile } from 'sdk';

// Telegram rejects answers to taps it considers too old (e.g. made while the
// bot was restarting); the tap's work still goes ahead.
const answer = (params) => api.answerCallbackQuery(params).catch((e) => {
  if (!(e instanceof BotApiError && e.code === 400)) throw e;
});
import {
  addDays, addMonths, dayKey, dayOf, dayRange, formatKhmerDate, monthKey, monthRange,
  parseDayKey, parseMonthKey, today, weekRange, yearRange,
} from '../lib/dates.js';
import { dayReport, dayTable, money, rangeReport } from '../lib/report.js';
import {
  getGroup, hasActiveSubscription, latestSubscription, recentPayments, renewSubscription, setLifetime,
  subscriptionHistory,
  totalsByBot, totalsByDay, upsertGroup,
} from '../lib/store.js';
import { syncNew, syncRange } from '../lib/sync.js';
import { adminPanel, handleTeam, urgentPanel } from '../lib/admin.js';
import { accessStatus, priceLabel, subscriptionScreen } from '../lib/billing.js';
import { TERMS_TEXT, WHITELIST_BOTS } from '../lib/config.js';
import { dailyConfig, dayPicker, dayReportScreen, savedAgents, subjectOf, subjectPicker, tokenSubject } from '../lib/daily.js';
import { agentListScreen, getAgent, monthScreen, sendAgentExcel, syncAgents } from '../lib/agents.js';
import { totalsPicker, totalsScreen } from '../lib/totals.js';
import { paymentSettings } from '../lib/settings.js';
import { deleteQuietly, edit, groupTitle, sendScreen, setCommands } from '../lib/telegram.js';
import { canManage, canView, isSuper, managersOf, roleIn } from '../lib/roles.js';
import {
  RENEW_MONTHS, calendarMenu, dailyMenu, menuKeyboard, menuText, monthlyMenu, parseView, renewMenu, reportKeyboard,
  syncMenu, weeklyMenu, yearCalendarMenu,
} from '../lib/ui.js';

export default async function (query) {
  let data = query.data ?? '';
  const msg = query.message;
  if (!msg) return answer({ callback_query_id: query.id });

  const chatId = msg.chat.id; // where screens are shown
  const messageId = msg.message_id;
  const superAdmin = await isSuper(query.from);
  const isPrivate = msg.chat.type === 'private';

  // In the private admin panel, buttons name the group they act on:
  // '@<group id>:<data>' (GROUP_<id> from the panel opens that group's menu).
  // Whether this user may act on it is checked below (roleIn).
  let scopedId = null;
  if (isPrivate) {
    const opened = /^GROUP_(-?\d+)$/.exec(data);
    if (opened) data = `@${opened[1]}:BACK`;
    const scoped = /^@(-?\d+):(.*)$/.exec(data);
    if (scoped) [scopedId, data] = [Number(scoped[1]), scoped[2]];
  }
  // Every button sent back from a scoped screen keeps the scope.
  const scope = (markup) => (!scopedId || !markup ? markup : {
    inline_keyboard: markup.inline_keyboard.map((row) =>
      row.map((b) => (b.callback_data ? { ...b, callback_data: `@${scopedId}:${b.callback_data}` } : b))),
  });

  // A photo message (the QR screen) can't become text, so it's replaced instead of edited.
  const replace = async (screen) => {
    await deleteQuietly(chatId, messageId);
    return sendScreen(chatId, { ...screen, reply_markup: scope(screen.reply_markup) });
  };
  const show = (text, extra = {}) => (msg.photo
    ? replace({ text, ...extra })
    : edit(chatId, messageId, text, { ...extra, reply_markup: scope(extra.reply_markup) }));
  const showScreen = (screen) => (screen.photo ? replace(screen) : show(screen.text, { parse_mode: screen.parse_mode, reply_markup: screen.reply_markup }));

  try {
    if (data === 'CLOSE') {
      await answer({ callback_query_id: query.id });
      return deleteQuietly(chatId, messageId);
    }

    const refuse = (text) => answer({ callback_query_id: query.id, text, show_alert: true });

    if (isPrivate) {
      // Super admins manage the admin team here.
      if (data.startsWith('TEAM')) {
        if (!superAdmin) return refuse('You are not admin 😡');
        await answer({ callback_query_id: query.id });
        scopedId = null;
        return handleTeam(data, chatId, show);
      }
      // The panel itself: super admins, and admins with at least one group.
      const pageOf = /^ADMIN_P_(\d+)$/.exec(data);
      const urgentPage = /^ADMIN_URG_(\d+)$/.exec(data);
      if (data === 'ADMIN_HOME' || pageOf || urgentPage) {
        const panel = urgentPage
          ? await urgentPanel(query.from, Number(urgentPage[1]))
          : await adminPanel(query.from, pageOf ? Number(pageOf[1]) : 0);
        if (!panel) return refuse('Use this in a group.');
        await answer({ callback_query_id: query.id });
        scopedId = null;
        return showScreen(panel);
      }
      if (!scopedId) return refuse('Use this in a group.');
    }

    // The group these buttons are about (this chat, or the one picked in the
    // panel) and what this user may do there.
    const scopedGroup = scopedId ? await getGroup(scopedId) : null;
    const target = scopedId ? { id: scopedId, type: 'group', title: scopedGroup?.name ?? null } : msg.chat;
    const role = await roleIn(query.from, target.id);
    if (isPrivate && !canView(role)) return refuse('Use this in a group.');
    const manager = canManage(role);

    if (data.startsWith('SYNC_') || data.startsWith('RENEW') || data === 'HISTORY' || data === 'LIFETIME') {
      if (!manager || (data === 'LIFETIME' && role !== 'super')) return refuse('You are not admin 😡');
      await answer({ callback_query_id: query.id });
      if (data === 'SYNC_MENU') return show(...menu(syncMenu((await getGroup(target.id))?.lifetime, role === 'super')));
      return handleSync(data, target, show, query.from, role);
    }

    // 📊 Agent Excel: only in the private admin panel (where canView was checked above).
    if (/^XL(SYNC|[AM]_|$)/.test(data) && !scopedId) return refuse('ប្រើក្នុង chat ផ្ទាល់ជាមួយ bot 🔒');

    // A trailing '!' is the report's Refresh button: catch up through the sync
    // helper first (payments missed while the bot was down), then redraw.
    const refresh = data.endsWith('!');
    // View options (format, bank filter) follow the key: see ui.viewKey.
    const { key, view } = parseView(refresh ? data.slice(0, -1) : data);
    await answer({ callback_query_id: query.id, text: refresh ? '🔄' : undefined });

    const group = scopedId ? scopedGroup : await getGroup(chatId);
    // Subscription screens work whether or not the group has paid.
    if (key === 'BILLING') return showScreen(await subscriptionScreen(target, group));
    if (key === 'TERMS') return api.sendMessage({ chat_id: chatId, text: TERMS_TEXT });

    if (!group) {
      if (scopedId) return showScreen(await adminPanel(query.from));
      return role === 'super' ? show(...menu(syncMenu(false, true))) : showScreen(await subscriptionScreen(target, null));
    }
    // Admins see an expired group's reports from their private panel; in the group they get the sync menu.
    if (!scopedId && !(await hasActiveSubscription(group))) {
      if (manager) return show(...menu(syncMenu(group.lifetime, role === 'super'))); // renew from here
      return showScreen(await subscriptionScreen(target, group));
    }

    const now = today();
    // 📥 lottery report (lib/daily.js) and 💰 its totals (lib/totals.js), for a
    // subject: everyone under the login, an agent or a member, as a trailing
    // _<who> (user code, or 'a' for everyone; none: the group's default).
    //   DREPORT / DRWK_<page>[_<who>] pick a day, DREP_<day>[_<who>] shows it,
    //   DREP!_… fetches it again; TOT[_<who>] picks a period, TOT_D_ / TOT_W_ /
    //   TOT_M_…[_<who>] show it; DRWHO[_<day>] / TOTWHO pick whose, WHOSYNC
    //   refreshes the list of agents and members.
    if (/^(DREPORT|DRWK_|DREP!?_|DRWHO|TOT$|TOT_|TOTWHO|WHOSYNC)/.test(key)) {
      const cfg = await dailyConfig(group.id, { secret: true });
      if (!cfg.enabled) {
        return show('📥 មុខងារនេះមិនទាន់បើកសម្រាប់ក្រុមនេះទេ។', { reply_markup: { inline_keyboard: [[{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'BACK' }]] } });
      }
      const totals = !!cfg.baseUrl;
      const whoOf = (tok) => subjectOf(group.id, tokenSubject(tok) ?? cfg.memberCode);
      if (key === 'DRWHO' || key.startsWith('DRWHO_') || key === 'TOTWHO' || key === 'WHOSYNC') {
        let note = '';
        if (key === 'WHOSYNC' || !(await savedAgents(group.id)).length) {
          try {
            await syncAgents(group);
            if (key === 'WHOSYNC') note = '\n✅ បានទាញបញ្ជីថ្មី';
          } catch (e) {
            note = `\n⚠️ ${String(e.message ?? e).slice(0, 200)}`;
          }
        }
        if (key === 'TOTWHO') return showScreen(await subjectPicker(group, { title: '💰 សរុប', target: (t) => `TOT_${t}`, back: 'TOT', note }));
        const day = /^DRWHO_(\d{4}-\d\d-\d\d)$/.exec(key)?.[1];
        return showScreen(await subjectPicker(group, { target: (t) => (day ? `DREP_${day}_${t}` : `DRWK_0_${t}`), back: day ? `DREP_${day}` : 'DREPORT', note }));
      }
      if (key === 'TOT' || key.startsWith('TOT_')) {
        if (!totals) return showScreen(await dayPicker(group));
        const pick = /^TOT(?:_(a|\d{1,20}))?$/.exec(key);
        if (pick) return showScreen(totalsPicker(await whoOf(pick[1])));
        const who = await whoOf(/_(a|\d{1,20})$/.exec(key)?.[1]);
        await show('⏳ កំពុងគណនា…');
        try {
          return showScreen(await totalsScreen(group, who, key, { refresh }));
        } catch (e) {
          console.error('totals failed', e);
          return show(`⚠️ ${String(e.message ?? e).slice(0, 300)}`, { reply_markup: { inline_keyboard: [[{ text: '🔄 ម្ដងទៀត', callback_data: key }], [{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'TOT' }]] } });
        }
      }
      if (key === 'DREPORT' || key.startsWith('DRWK_')) {
        const [, page, tok] = /^DRWK_(\d+)(?:_(a|\d{1,20}))?$/.exec(key) ?? [];
        return showScreen(await dayPicker(group, Number(page) || 0, { totals, who: await whoOf(tok) }));
      }
      const [, bang, day, tok] = /^DREP(!?)_(\d{4}-\d\d-\d\d)(?:_(a|\d{1,20}))?$/.exec(key) ?? [];
      if (!day) return showScreen(await dayPicker(group, 0, { totals }));
      return showScreen(await dayReportScreen(group, day, { refresh: !!bang, key: (await whoOf(tok)).key }));
    }

    // 📊 Agent Excel (private admin panel only, checked above): XL lists the group's
    // agents, XLSYNC refreshes them, XLA_<id> picks a month, XLM_<id>_<YYYY-MM> builds
    // it and sends it to that private chat.
    if (key === 'XL' || key === 'XLSYNC' || key.startsWith('XLA_') || key.startsWith('XLM_')) {
      if (key === 'XL' || key === 'XLSYNC') return showScreen(await agentListScreen(group, { refresh: key === 'XLSYNC' }));
      const [, id, month] = /^XL[AM]_(\d+)(?:_(\d{4}-\d\d))?$/.exec(key) ?? [];
      const agent = id && (await getAgent(Number(id)));
      if (!agent || agent.groupId !== group.id) return showScreen(await agentListScreen(group));
      if (key.startsWith('XLA_') || !month) return showScreen(monthScreen(agent));
      await show(`⏳ កំពុងរៀបចំ Excel ${agent.username} · ${month}…`);
      try {
        return showScreen(await sendAgentExcel(group, agent, month, query.from.id, api, InputFile, isPrivate));
      } catch (e) {
        console.error('agent excel failed', e);
        // The bot can only message people who have started it.
        const blocked = e instanceof BotApiError && e.code === 403;
        return show(blocked ? '⚠️ សូមបើក chat ជាមួយ bot ហើយចុច Start ជាមុន ទើប bot អាចផ្ញើ Excel ទៅអ្នកបាន។' : `⚠️ ${String(e.message ?? e).slice(0, 300)}`, { reply_markup: { inline_keyboard: [[{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: `XLA_${agent.id}` }]] } });
      }
    }

    switch (key) {
      // Menus are built for whoever tapped, so only admins see the Sync row.
      case 'BACK': {
        const status = await accessStatus(group);
        const cfg = await dailyConfig(group.id);
        // 📊 Excel ភ្នាក់ងារ only in the private panel, for groups whose report signs in.
        const { inline_keyboard } = menuKeyboard(manager, status, cfg.enabled, !!scopedId && !!cfg.baseUrl);
        // In the private panel: the group's name on top, and a way back to all groups.
        if (scopedId) {
          return show(`${await groupTitle(group)}\n${menuText(status)}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                ...inline_keyboard.filter((r) => r[0]?.callback_data !== 'CLOSE'),
                [{ text: '🛠 ក្រុមទាំងអស់', callback_data: 'ADMIN_HOME' }],
              ],
            },
          });
        }
        return show(menuText(status), { reply_markup: { inline_keyboard } });
      }
      case 'DAILY':   return show(...menu(dailyMenu(now)));
      case 'WEEKLY':  return show(...menu(weeklyMenu(now)));
      case 'MONTHLY': return show(...menu(monthlyMenu(now)));
    }

    if (key.startsWith('YCAL_')) {
      const year = Number(key.slice(5));
      if (!Number.isInteger(year)) return;
      const paid = await totalsByDay(group.id, yearRange(year));
      return show(...menu(yearCalendarMenu(year, now, new Set(paid.map((r) => r.day.slice(0, 7))))));
    }

    if (key.startsWith('CAL_')) {
      const month = parseMonthKey(key.slice(4));
      if (!month) return;
      const paid = await totalsByDay(group.id, monthRange(month.y, month.m));
      return show(...menu(calendarMenu(month, now, new Set(paid.map((r) => r.day)))));
    }

    const report = resolveReport(key, now);
    if (!report) return;

    // In the private panel a report starts with which group it's for.
    const titled = async (text) => (scopedId ? `${await groupTitle(group)}\n${text}` : text);
    const render = async () => {
      if (report.day) {
        const range = dayRange(report.day);
        const rows = await totalsByBot(group.id, range);
        const compare = {
          yesterday: await totalsByBot(group.id, dayRange(addDays(report.day, -1))),
          lastWeek: await totalsByBot(group.id, dayRange(addDays(report.day, -7))),
        };
        const text = view.cards
          ? dayReport(report.day, rows, query.from, await recentPayments(group.id, range), compare)
          : dayTable(report.day, rows, query.from, compare);
        return show(await titled(text), { parse_mode: 'HTML', reply_markup: reportKeyboard(report.key, report.parent, view, { day: true }) });
      }
      const data = {
        days: await totalsByDay(group.id, report.range, view.bank),
        bots: await totalsByBot(group.id, report.range),
        prev: await totalsByBot(group.id, report.previous),
      };
      const banks = [...new Set(data.bots.map((r) => r.botTgId))];
      const text = rangeReport(report.range, data, query.from, { month: !!report.month, daily: view.daily, bank: view.bank });
      return show(await titled(text), {
        parse_mode: 'HTML',
        reply_markup: reportKeyboard(report.key, report.parent, view, { month: !!report.month, banks, bankName: (id) => WHITELIST_BOTS[id] ?? String(id) }),
      });
    };

    // Payments arrive live (handlers/message.js), so a report is just a query.
    if (refresh) await catchUp(group);
    await render();
  } catch (e) {
    console.error(e);
    await api.sendMessage({ chat_id: chatId, text: '⚠️ Something went wrong. Please try again.' });
  }
}

const menu = ({ text, reply_markup }) => [text, { reply_markup }];

/** A failed catch-up still lets the report show what is stored. */
async function catchUp(group) {
  try {
    await syncNew(group);
  } catch (e) {
    console.error('syncNew failed, reporting stored data', e);
  }
}

/**
 * Maps a report button to { day } or { range }, plus `key`: the same report as
 * absolute callback data (so Refresh shows the same period tomorrow) and
 * `parent`: the submenu Back returns to.
 */
function resolveReport(data, now) {
  const day = (d) => d && { day: d, key: `DATE_${dayKey(d)}`, parent: 'DAILY' };
  // Opened from the calendar (a day, or the month title): Back returns to that month's calendar.
  const calendarDay = (d) => d && { day: d, key: `CDATE_${dayKey(d)}`, parent: `CAL_${monthKey(d)}` };
  const calendarMonth = (m) => m && { ...month(m), key: `CMONTH_${monthKey(m)}`, parent: `CAL_${monthKey(m)}` };
  // Picked from the year calendar: Back returns to that year.
  const yearMonth = (m) => m && { ...month(m), key: `YMONTH_${monthKey(m)}`, parent: `YCAL_${m.y}` };
  // `previous`: the period just before, for the comparison line.
  const week = (d) => d && {
    range: weekRange(d), previous: weekRange(addDays(d, -7)),
    key: `WEEK_${dayKey(dayOf(weekRange(d).start))}`, parent: 'WEEKLY',
  };
  const month = (m) => m && {
    month: true, range: monthRange(m.y, m.m), previous: monthRange(addMonths(m, -1).y, addMonths(m, -1).m),
    key: `MONTH_${monthKey(m)}`, parent: 'MONTHLY',
  };

  switch (data) {
    case 'TODAY':      return day(now);
    case 'YESTERDAY':  return day(addDays(now, -1));
    case 'THIS_WEEK':  return week(now);
    case 'LAST_WEEK':  return week(addDays(now, -7));
    case 'THIS_MONTH': return month(now);
    case 'LAST_MONTH': return month(addMonths(now, -1));
  }
  if (data.startsWith('DATE_')) return day(parseDayKey(data.slice(5)));
  if (data.startsWith('CDATE_')) return calendarDay(parseDayKey(data.slice(6)));
  if (data.startsWith('WEEK_')) return week(parseDayKey(data.slice(5)));
  if (data.startsWith('MONTH_')) return month(parseMonthKey(data.slice(6)));
  if (data.startsWith('CMONTH_')) return calendarMonth(parseMonthKey(data.slice(7)));
  if (data.startsWith('YMONTH_')) return yearMonth(parseMonthKey(data.slice(7)));
  return null;
}

/** Admin actions on `chat` (the group: this chat, or the one picked in the private panel). */
async function handleSync(data, chat, show, admin, role) {
  const group = await upsertGroup(chat.id, chat.title ?? null);

  if (data === 'SYNC_GROUP') {
    await setCommands(chat.id, await managersOf(group.id));
    return show('✅ Group info synced');
  }

  const latest = await latestSubscription(group.id);
  const endLabel = latest ? formatKhmerDate(dayOf(latest.endDate)) : '—';
  const name = group.name ?? String(chat.id);

  if (data === 'RENEW') {
    const pay = await paymentSettings();
    return show(...menu(renewMenu(name, endLabel, (m) => priceLabel(m, pay))));
  }

  if (data === 'LIFETIME') {
    const lifetime = !group.lifetime;
    await setLifetime(group.id, lifetime);
    const { reply_markup } = syncMenu(lifetime, role === 'super');
    return show(lifetime
      ? `♾️ "${name}" now has lifetime access: no expiry, and no subscription button.`
      : `"${name}" is back on normal billing. Current period ends: ${endLabel}.`, { reply_markup });
  }

  if (data.startsWith('RENEW_')) {
    const months = Number(data.slice(6));
    if (!RENEW_MONTHS.includes(months)) return;
    const pay = await paymentSettings();
    const sub = await renewSubscription(group.id, {
      months,
      price: pay.price * months,
      currency: pay.currency,
      recordedBy: admin.id,
    });
    const until = formatKhmerDate(dayOf(sub.endDate));
    await show(`✅ Recorded ${priceLabel(months, pay)} for ${months} month(s).\n"${name}" is active until ${until}.`, {
      reply_markup: { inline_keyboard: [[{ text: '🧾 History', callback_data: 'HISTORY' }, { text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'SYNC_MENU' }]] },
    });
    // Let the group know it can use the reports again.
    return api.sendMessage({ chat_id: chat.id, text: `✅ ការជាវត្រូវបានបន្ត ដល់ ${until}។ ប្រើ /menu ដើម្បីមើលរបាយការណ៍។` });
  }

  if (data === 'HISTORY') {
    const rows = await subscriptionHistory(group.id);
    const fmt = (ts) => { const d = dayOf(ts); return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`; };
    const label = (r) => r.isTrial ? 'trial' : r.source;
    const amount = (r) => (r.price ? ` · ${r.currency === 'XTR' ? `${r.price} ⭐` : `${money(r.price)} ${r.currency}`}` : '');
    const lines = rows.map((r) => `${fmt(r.startDate)} → ${fmt(r.endDate)}  ${label(r)}${amount(r)}`);
    return show(`🧾 "${name}" — last ${rows.length} period(s)\n\n<pre>${lines.join('\n') || 'none'}</pre>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔄 Renew', callback_data: 'RENEW' }, { text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'SYNC_MENU' }]] },
    });
  }

  const now = today();
  if (data === 'SYNC_YEAR') {
    // One helper call per month keeps each call small (Workers limit CPU time per request).
    let count = 0;
    for (let m = 1; m <= now.m; m++) {
      await show(`🗓️ Syncing all messages from this year...\n⏳ ${m}/${now.m}`);
      count += await syncRange(group, monthRange(now.y, m));
    }
    return show(`✅ Sync completed successfully! (${count} payments)`);
  }

  const ranges = {
    SYNC_TODAY: ['📅 Syncing today messages...', dayRange(now)],
    SYNC_WEEK:  ['📆 Syncing this week messages...', weekRange(now)],
  };
  const entry = ranges[data];
  if (!entry) return;

  const [loading, range] = entry;
  await show(`${loading}\n⏳ Please wait...`);
  const count = await syncRange(group, range);
  await show(`✅ Sync completed successfully! (${count} payments)`);
}
