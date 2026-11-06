// Button presses from the /menu and /sync keyboards, in groups and in a bot
// admin's private-chat panel.

import { api, BotApiError, InputFile, renderImages } from 'sdk';

// Telegram rejects answers to taps it considers too old (e.g. made while the
// bot was restarting); the tap's work still goes ahead.
// The answer goes out alongside the tap's work rather than before it (it only
// stops the button's spinner; waiting for it cost every tap ~220 ms): the
// handler waits for it at the end (the Worker stops when the handler returns).
const answering = new Set();
const answer = (params) => {
  const p = api.answerCallbackQuery(params).catch((e) => {
    if (!(e instanceof BotApiError && e.code === 400)) console.error('answerCallbackQuery', e?.message ?? e);
  });
  answering.add(p);
  p.finally(() => answering.delete(p));
  return undefined;
};

/** The album's photo message ids above a 🖼 keyboard message, or null. */
async function albumOf(chatId, messageId) {
  try {
    const ids = JSON.parse((await getSetting(`album:${chatId}:${messageId}`)) ?? 'null');
    return Array.isArray(ids) && ids.length ? ids : null;
  } catch {
    return null;
  }
}

/** Leaving the 🖼 screen: its album is deleted. */
async function dropAlbum(chatId, messageId) {
  const ids = await albumOf(chatId, messageId);
  if (!ids) return;
  await Promise.all(ids.map((id) => deleteQuietly(chatId, id)));
  await setSetting(`album:${chatId}:${messageId}`, '[]');
}

export default async function (query) {
  try {
    return await handle(query);
  } finally {
    await Promise.all([...answering]);
  }
}
import {
  addDays, addMonths, dayKey, dayOf, dayRange, formatKhmerDate, monthKey, monthRange,
  parseDayKey, parseMonthKey, today, weekRange, yearRange,
} from '../lib/dates.js';
import { dayReport, dayTable, money, rangeReport } from '../lib/report.js';
import {
  getGroup, getSetting, hasActiveSubscription, latestSubscription, recentPayments, renewSubscription, setLifetime, setSetting,
  subscriptionHistory,
  totalsByBot, totalsByDay, upsertGroup,
} from '../lib/store.js';
import { syncNew, syncRange } from '../lib/sync.js';
import { adminPanel, handleTeam, urgentPanel } from '../lib/admin.js';
import { accessStatus, offerLabel, priceFor, priceLabel, subscriptionScreen } from '../lib/billing.js';
import { TERMS_TEXT, WHITELIST_BOTS } from '../lib/config.js';
import { dailyConfig, dayPicker, dayReportScreen, groupSubject, savedAgents, subjectOf, subjectPicker, tokenSubject, typePicker } from '../lib/daily.js';
import { getLogin, listLogins } from '../lib/logins.js';
import { agentChoiceScreen, agentDayImages, agentListScreen, getAgent, imageDays, monthScreen, sendAgentExcel, syncAgents } from '../lib/agents.js';
import { imageDayPicker, imageKeyboard } from '../lib/sheetimage.js';
import { totalsPicker, totalsScreen } from '../lib/totals.js';
import { paymentSettings } from '../lib/settings.js';
import { deleteQuietly, edit, groupTitle, sendScreen, setCommands } from '../lib/telegram.js';
import { canManage, canView, isSuper, loginRole, managersOf, ownsLogin, roleIn } from '../lib/roles.js';
import { askForReceipt, handleReceiptButton } from '../lib/receipts.js';
import {
  RENEW_MONTHS, bankDayPicker, bankPeriodPicker, bankTypePicker, calendarMenu, menuKeyboard, menuText, parseView, renewMenu, reportKeyboard,
  syncMenu, yearCalendarMenu,
} from '../lib/ui.js';

async function handle(query) {
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
  // The panel's own 📥 lottery report (super admins): 'L<login id>:<data>'.
  let loginScope = null;
  if (isPrivate) {
    const opened = /^GROUP_(-?\d+)$/.exec(data);
    if (opened) data = `@${opened[1]}:BACK`;
    const scoped = /^@(-?\d+):(.*)$/.exec(data);
    if (scoped) [scopedId, data] = [Number(scoped[1]), scoped[2]];
    const byLogin = /^L(\d+):(.*)$/.exec(data);
    if (byLogin) [loginScope, data] = [Number(byLogin[1]), byLogin[2]];
  }
  // Every button sent back from a scoped screen keeps the scope.
  const scope = (markup) => {
    const prefix = scopedId ? `@${scopedId}:` : loginScope ? `L${loginScope}:` : '';
    return !prefix || !markup ? markup : {
      inline_keyboard: markup.inline_keyboard.map((row) =>
        row.map((b) => (b.callback_data ? { ...b, callback_data: `${prefix}${b.callback_data}` } : b))),
    };
  };

  // A photo message (the QR screen) can't become text, so it's replaced instead of edited.
  const replace = async (screen) => {
    await deleteQuietly(chatId, messageId);
    return sendScreen(chatId, { ...screen, reply_markup: scope(screen.reply_markup) });
  };
  const show = (text, extra = {}) => (msg.photo
    ? replace({ text, ...extra })
    : edit(chatId, messageId, text, { ...extra, reply_markup: scope(extra.reply_markup) }));
  const showScreen = (screen) => (screen.photo ? replace(screen) : show(screen.text, { parse_mode: screen.parse_mode, reply_markup: screen.reply_markup, rich: screen.rich }));

  /**
   * 📥 lottery report screens (lib/daily.js) and 💰 its totals (lib/totals.js)
   * for `cfg` ({ loginId, memberCode }) and `login` (with secret): `mine` is
   * whose they show by default; `canSwitch` (only the panel's own 📥, super
   * admins) lets a trailing _<who> (user code, or 'a' for everyone) pick
   * someone else under the login.
   *   DRTYPE picks the report type (📋 per day or 💰 totals); DRNOW[_<who>]
   *   and TOTNOW[_<who>] open each on today;
   *   DREPORT / DRWK_<page>[_<who>] pick a day, DREP_<day>[_<who>] shows it,
   *   DREP!_… fetches it again; TOT[_<who>] picks a period, TOT_D_ / TOT_W_ /
   *   TOT_M_…[_<who>] show it; DRWHO[_<day>] / TOTWHO pick whose, WHOSYNC
   *   refreshes the list of agents and members.
   */
  const lottery = async (key, { cfg, login, group, mine, canSwitch, refresh }) => {
    // Anyone else only for super admins in the private panel.
    const whoOf = async (tok) => (canSwitch && tokenSubject(tok) !== undefined ? subjectOf(cfg.loginId, tokenSubject(tok)) : mine);
    // Today, worked out on the tap (a button may be from yesterday).
    const now = /^(DRNOW|TOTNOW)(_(?:a|\d{1,20}))?$/.exec(key);
    if (now) key = `${now[1] === 'DRNOW' ? 'DREP' : 'TOT_D'}_${dayKey(today())}${now[2] ?? ''}`;
    const type = /^DRTYPE(?:_(a|\d{1,20}))?$/.exec(key);
    if (type) return showScreen(typePicker(await whoOf(type[1]), { canSwitch }));
    if (/^(DRWHO|TOTWHO|WHOSYNC)/.test(key)) {
      if (!canSwitch) return showScreen(await dayPicker(cfg, mine));
      let note = '';
      if (key === 'WHOSYNC' || !(await savedAgents(cfg.loginId)).length) {
        try {
          await syncAgents(login);
          if (key === 'WHOSYNC') note = '\n✅ បានទាញបញ្ជីថ្មី';
        } catch (e) {
          note = `\n⚠️ ${String(e.message ?? e).slice(0, 200)}`;
        }
      }
      if (key === 'TOTWHO') return showScreen(await subjectPicker(cfg, { title: '💰 របាយការណ៍សរុប', target: (t) => `TOTNOW_${t}`, back: 'BACK', note }));
      const day = /^DRWHO_(\d{4}-\d\d-\d\d)$/.exec(key)?.[1];
      return showScreen(await subjectPicker(cfg, { target: (t) => (day ? `DREP_${day}_${t}` : `DRTYPE_${t}`), back: day ? `DREP_${day}` : 'BACK', note }));
    }
    if (key === 'TOT' || key.startsWith('TOT_')) {
      const pick = /^TOT(?:_(a|\d{1,20}))?$/.exec(key);
      if (pick) return showScreen(totalsPicker(await whoOf(pick[1]), { canSwitch }));
      const who = await whoOf(/_(a|\d{1,20})$/.exec(key)?.[1]);
      // Saved days answer at once: then it's one edit, like the by-draw report.
      // Only when days have to be fetched does '⏳' show meanwhile.
      let waiting = null;
      const slow = setTimeout(() => { waiting = show('⏳ កំពុងគណនា…').catch(() => {}); }, SLOW_MS);
      const settle = async () => {
        clearTimeout(slow);
        await waiting; // the '⏳' edit must land before the answer, not after
      };
      try {
        const screen = await totalsScreen(group, login, who, key, { refresh, canSwitch });
        await settle();
        return showScreen(screen);
      } catch (e) {
        await settle();
        console.error('totals failed', e);
        return show(`⚠️ ${String(e.message ?? e).slice(0, 300)}`, { reply_markup: { inline_keyboard: [[{ text: '🔄 ម្ដងទៀត', callback_data: key }], [{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'TOT' }]] } });
      }
    }
    if (key === 'DREPORT' || key.startsWith('DRWK_')) {
      const [, page, tok] = /^DRWK_(\d+)(?:_(a|\d{1,20}))?$/.exec(key) ?? [];
      return showScreen(await dayPicker(cfg, await whoOf(tok), Number(page) || 0, { canSwitch }));
    }
    const [, bang, day, tok] = /^DREP(!?)_(\d{4}-\d\d-\d\d)(?:_(a|\d{1,20}))?$/.exec(key) ?? [];
    if (!day) return showScreen(await dayPicker(cfg, mine, 0, { canSwitch }));
    return showScreen(await dayReportScreen(group, cfg, await whoOf(tok), day, { refresh: !!bang, canSwitch }));
  };

  try {
    if (data === 'CLOSE') {
      await answer({ callback_query_id: query.id });
      return deleteQuietly(chatId, messageId);
    }

    const refuse = (text) => answer({ callback_query_id: query.id, text, show_alert: true });

    // 🧾 A receipt's one-tap buttons on an admin's copy (lib/receipts.js): renew or turn down.
    if (data.startsWith('RCPT_')) {
      const result = await handleReceiptButton(data, query.from);
      return answer({ callback_query_id: query.id, text: result ?? undefined, show_alert: !!result && !result.startsWith('✅') && !result.startsWith('❌') });
    }
    // 💬 ផ្ញើវិក្កយបត្រ on ⭐ ការជាវ, in the group: ask for the receipt as a reply there.
    if (data === 'RECEIPT') {
      if (isPrivate) return refuse('សូមផ្ញើវិក្កយបត្រនៅក្នុងក្រុម។');
      await answer({ callback_query_id: query.id });
      return askForReceipt(chatId);
    }

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
      // The panel's own 📥 lottery report (super admins), not tied to a group:
      // LOTTO picks a login when there are more than one, then L<id>:… shows
      // its screens, with 🔀 for everyone under it, each agent and member.
      if (data === 'LOTTO' || loginScope) {
        // Super admins: every login; managers: the logins they added.
        const lottoRole = superAdmin ? 'super' : await loginRole(query.from);
        if (!lottoRole) return refuse('You are not admin 😡');
        const refresh = data.endsWith('!');
        await answer({ callback_query_id: query.id, text: refresh ? '🔄' : undefined });
        if (data === 'LOTTO') {
          const logins = (await listLogins()).filter((l) => l.baseUrl && ownsLogin(lottoRole, query.from, l));
          if (logins.length !== 1) {
            return show(logins.length ? '📥 <b>របាយការណ៍ឆ្នោត</b>\nជ្រើសរើស Login:' : '📥 មិនទាន់មាន Login ឆ្នោតទេ — បន្ថែមនៅ Mini App ⚙️។', {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [...logins.map((l) => [{ text: `🔑 ${l.username}`, callback_data: `L${l.id}:DRWHO` }]), [{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'ADMIN_HOME' }]] },
            });
          }
          [loginScope, data] = [logins[0].id, 'DRWHO'];
        }
        const key = refresh ? data.slice(0, -1) : data;
        const login = await getLogin(loginScope, { secret: true });
        if (!login || !ownsLogin(lottoRole, query.from, login) || key === 'BACK' || !LOTTERY_KEY.test(key)) {
          loginScope = null;
          return showScreen(await adminPanel(query.from));
        }
        const cfg = { loginId: login.id, memberCode: '' };
        const group = { name: login.username, tgId: 0, icon: '🔑' };
        return lottery(key, { cfg, login, group, mine: await subjectOf(login.id, ''), canSwitch: true, refresh });
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
    if (/^XL(SYNC|[AMXID]_|$)/.test(data) && !scopedId) return refuse('ប្រើក្នុង chat ផ្ទាល់ជាមួយ bot 🔒');

    // A trailing '!' is the report's Refresh button: catch up through the sync
    // helper first (payments missed while the bot was down), then redraw.
    const refresh = data.endsWith('!');
    // View options (cards, per-day rows, bank filter) follow the key: see ui.viewKey.
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
    /** The bank day picker `page` weeks back, with • on its days that have payments. */
    const bankDays = async (page) => {
      const first = addDays(now, -7 * page);
      const paid = await totalsByDay(group.id, { start: dayRange(addDays(first, -6)).start, end: dayRange(first).end });
      return bankDayPicker(now, page, new Set(paid.map((r) => r.day)));
    };
    // 📥 lottery report in a group (and that group in the panel): its member
    // only. Switching to anyone else is the panel's own 📥 (LOTTO, above).
    if (LOTTERY_KEY.test(key)) {
      const cfg = await dailyConfig(group.id);
      const login = cfg.enabled && cfg.memberCode ? await getLogin(cfg.loginId, { secret: true }) : null;
      if (!login) {
        return show('📥 មុខងារនេះមិនទាន់បើកសម្រាប់ក្រុមនេះទេ។', { reply_markup: { inline_keyboard: [[{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'BACK' }]] } });
      }
      // In a group (here or in the panel), only the group's member.
      return lottery(key, { cfg, login, group, mine: await groupSubject(cfg), canSwitch: false, refresh });
    }

    // 📊 Agent Excel (private admin panel only, checked above): XL lists the agents
    // under the group's login, XLSYNC refreshes them, XLA_<id> picks a month,
    // XLM_<id>_<YYYY-MM> builds it and sends it to that private chat.
    if (key === 'XL' || key === 'XLSYNC' || /^XL[AMXID]_/.test(key)) {
      const cfg = await dailyConfig(group.id);
      const login = cfg.loginId ? await getLogin(cfg.loginId, { secret: true }) : null;
      // Super admins: any login; managers: only the logins they added.
      if (login && !ownsLogin(role === 'super' ? 'super' : await loginRole(query.from), query.from, login)) return refuse('🔒 Login នេះជារបស់អ្នកគ្រប់គ្រងផ្សេង។');
      if (!login) return show('⚠️ ក្រុមនេះមិនទាន់មាន Login ឆ្នោតទេ។', { reply_markup: { inline_keyboard: [[{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'BACK' }]] } });
      if (key === 'XL' || key === 'XLSYNC') return showScreen(await agentListScreen(login, { refresh: key === 'XLSYNC' }));
      const [, kind, id, month, day] = /^XL([AMXID])_(\d+)(?:_(\d{4}-\d\d)(?:-(\d\d))?)?$/.exec(key) ?? [];
      const agent = id && (await getAgent(Number(id)));
      if (!agent || agent.loginId !== login.id) return showScreen(await agentListScreen(login));
      if (kind === 'A' || kind === 'X') await dropAlbum(chatId, messageId);
      if (kind === 'A') return showScreen(agentChoiceScreen(agent));
      if (kind === 'X' || (kind === 'M' && !month)) return showScreen(monthScreen(agent));
      // 🖼 a day as the Excel's day tab (today unless one is picked); 📅 XLD_ picks the day.
      const span = imageDays();
      if (kind === 'D') return showScreen(imageDayPicker(agent, month && month >= span.first.slice(0, 7) ? month : span.today.slice(0, 7), span));
      if (kind === 'I') {
        let wanted = month && day ? `${month}-${day}` : span.today;
        if (wanted < span.first || wanted > span.today) wanted = span.today;
        const keyboard = imageKeyboard(agent.id, wanted, span);
        // The two pictures go as an album, with this keyboard message under it
        // (an album can't carry buttons); album:<chat>:<message> names its photos.
        const album = msg.photo ? null : await albumOf(chatId, messageId);
        if (msg.photo) await api.editMessageCaption({ chat_id: chatId, message_id: messageId, caption: '⏳ កំពុងរៀបចំរូបភាព…' }).catch(() => {});
        else await show('⏳ កំពុងរៀបចំរូបភាព…');
        try {
          const img = await agentDayImages(login, agent, wanted, renderImages, { refresh });
          if (img.text) {
            if (msg.photo) await deleteQuietly(chatId, messageId);
            return msg.photo ? sendScreen(chatId, { text: img.text, reply_markup: scope(keyboard) }) : show(img.text, { reply_markup: keyboard });
          }
          const media = img.images.map((im, i) => ({ type: 'photo', media: im.fileId ?? `attach://p${i}` }));
          const files = Object.fromEntries(img.images.map((im, i) => [`p${i}`, im.fileId ? undefined : new InputFile(im.bytes, `${agent.username}-${wanted}-${i + 1}.png`, { type: 'image/png' })]));
          let ids = null;
          if (album) {
            // Day changed under an album: both photos change in place.
            try {
              const sent = await Promise.all(album.map((id, i) => api.editMessageMedia({ chat_id: chatId, message_id: id, media: media[i], ...(files[`p${i}`] ? { [`p${i}`]: files[`p${i}`] } : {}) })
                .catch((e) => { if (e instanceof BotApiError && e.description?.includes('not modified')) return null; throw e; })));
              await Promise.all(sent.map((m, i) => m?.photo && !img.images[i].fileId && img.images[i].remember(m.photo.at(-1).file_id)));
              ids = album;
            } catch (e) {
              console.warn('album edit failed, sending it again:', e?.message ?? e);
              await Promise.all(album.map((id) => deleteQuietly(chatId, id)));
            }
          }
          if (ids) return show(img.caption, { reply_markup: keyboard });
          // A new album, then the keyboard under it (this message goes).
          const sent = await api.sendMediaGroup({ chat_id: chatId, media, ...files });
          await Promise.all(sent.map((m, i) => !img.images[i].fileId && m.photo && img.images[i].remember(m.photo.at(-1).file_id)));
          await deleteQuietly(chatId, messageId);
          const under = await api.sendMessage({ chat_id: chatId, text: img.caption, reply_markup: scope(keyboard) });
          await setSetting(`album:${chatId}:${under.message_id}`, JSON.stringify(sent.map((m) => m.message_id)));
          return undefined;
        } catch (e) {
          console.error('agent image failed', e);
          const text = `⚠️ ${String(e.message ?? e).slice(0, 300)}`;
          if (msg.photo) return api.editMessageCaption({ chat_id: chatId, message_id: messageId, caption: text, reply_markup: scope(keyboard) }).catch(() => {});
          return show(text, { reply_markup: keyboard });
        }
      }
      await show(`⏳ កំពុងរៀបចំ Excel ${agent.username} · ${month}…`);
      try {
        return showScreen(await sendAgentExcel(login, agent, month, query.from.id, api, InputFile, isPrivate));
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
        const [status, cfg, title] = await Promise.all([accessStatus(group), dailyConfig(group.id), scopedId ? groupTitle(group) : null]);
        // 📊 Excel / 🖼 only in the private panel, for groups that follow a login
        // this admin may use (super admins: any; managers: their own).
        const excel = !!scopedId && !!cfg.loginId
          && ownsLogin(role === 'super' ? 'super' : await loginRole(query.from), query.from, await getLogin(cfg.loginId));
        const { inline_keyboard } = menuKeyboard(manager, status, cfg.enabled && !!cfg.memberCode, excel);
        // In the private panel: the group's name on top, and a way back to all groups.
        if (scopedId) {
          return show(`${title}\n${menuText(status)}`, {
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
      // 📊 the bank report: the type choice (📋 today / 💰 this week), like the lottery report;
      // the day picker (DAILY: older messages' menu); 💰 its weeks and months.
      case 'BANK':    return showScreen(bankTypePicker());
      case 'DAILY':   return showScreen(await bankDays(0));
      case 'BANKTOT':
      case 'WEEKLY':
      case 'MONTHLY': return showScreen(bankPeriodPicker(now));
    }

    if (/^BANKWK_\d{1,3}$/.test(key)) return showScreen(await bankDays(Number(key.slice(7))));

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
    // In the private panel a report starts with which group it's for (both forms: lib/rich.js).
    const titled = async ({ text, rich }) => {
      if (!scopedId) return { text, rich };
      const title = await groupTitle(group);
      return { text: `${title}\n${text}`, rich: `<p>${title}</p>${rich}` };
    };
    const render = async () => {
      if (report.day) {
        const range = dayRange(report.day);
        const rows = await totalsByBot(group.id, range);
        const compare = {
          yesterday: await totalsByBot(group.id, dayRange(addDays(report.day, -1))),
          lastWeek: await totalsByBot(group.id, dayRange(addDays(report.day, -7))),
        };
        const screen = await titled(view.cards
          ? dayReport(report.day, rows, query.from, await recentPayments(group.id, range), compare)
          : dayTable(report.day, rows, query.from, compare));
        return show(screen.text, { parse_mode: 'HTML', rich: screen.rich, reply_markup: reportKeyboard(report.key, report.prev, report.next, view, { day: true }) });
      }
      const data = {
        days: await totalsByDay(group.id, report.range, view.bank),
        bots: await totalsByBot(group.id, report.range),
        prev: await totalsByBot(group.id, report.previous),
      };
      const banks = [...new Set(data.bots.map((r) => r.botTgId))];
      const screen = await titled(rangeReport(report.range, data, query.from, { month: !!report.month, daily: view.daily, bank: view.bank }));
      return show(screen.text, {
        parse_mode: 'HTML',
        rich: screen.rich,
        reply_markup: reportKeyboard(report.key, report.prev, report.next, view, { month: !!report.month, banks, bankName: (id) => WHITELIST_BOTS[id] ?? String(id) }),
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

/** How long 💰 totals may take before '⏳' shows (they fetch missing days). */
const SLOW_MS = 1500;

/** Buttons of the 📥 lottery report and its 💰 totals (see `lottery` in the handler). */
const LOTTERY_KEY = /^(DRTYPE|DRNOW|TOTNOW|DREPORT|DRWK_|DREP!?_|DRWHO|TOT$|TOT_|TOTWHO|WHOSYNC)/;

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
 * absolute callback data (so 🔄 shows the same period tomorrow), and `prev` /
 * `next`: the period before and after (next is null past today). Days and
 * months picked from the calendars (CDATE_ / CMONTH_ / YMONTH_, older
 * messages) are the same reports.
 */
function resolveReport(data, now) {
  const todayKey = dayKey(now);
  const day = (d) => d && dayKey(d) <= todayKey && {
    day: d, key: `DATE_${dayKey(d)}`,
    prev: `DATE_${dayKey(addDays(d, -1))}`, next: dayKey(addDays(d, 1)) <= todayKey ? `DATE_${dayKey(addDays(d, 1))}` : null,
  };
  // `previous`: the period just before, for the comparison line.
  const week = (d) => {
    if (!d || dayKey(d) > todayKey) return null;
    const monday = dayOf(weekRange(d).start);
    const after = addDays(monday, 7);
    return {
      range: weekRange(d), previous: weekRange(addDays(d, -7)), key: `WEEK_${dayKey(monday)}`,
      prev: `WEEK_${dayKey(addDays(monday, -7))}`, next: dayKey(after) <= todayKey ? `WEEK_${dayKey(after)}` : null,
    };
  };
  const month = (m) => {
    if (!m || monthKey(m) > monthKey(now)) return null;
    const before = addMonths(m, -1);
    const after = addMonths(m, 1);
    return {
      month: true, range: monthRange(m.y, m.m), previous: monthRange(before.y, before.m), key: `MONTH_${monthKey(m)}`,
      prev: `MONTH_${monthKey(before)}`, next: monthKey(after) <= monthKey(now) ? `MONTH_${monthKey(after)}` : null,
    };
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
  if (data.startsWith('CDATE_')) return day(parseDayKey(data.slice(6)));
  if (data.startsWith('WEEK_')) return week(parseDayKey(data.slice(5)));
  if (data.startsWith('MONTH_')) return month(parseMonthKey(data.slice(6)));
  if (data.startsWith('CMONTH_') || data.startsWith('YMONTH_')) return month(parseMonthKey(data.slice(7)));
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
    return show(...menu(renewMenu(name, endLabel, (m) => offerLabel(m, pay))));
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
      price: priceFor(months, pay),
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
