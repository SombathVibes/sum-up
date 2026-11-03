// The private-chat admin panel: the groups this admin may see (all of them for
// super admins) with their access, a way into each group's reports and admin
// actions, and — for super admins — the admin team: add admins and set what
// each may do in which group.

import { api } from 'sdk';
import { accessStatus } from './billing.js';
import { dayOf, pad2 } from './dates.js';
import {
  getAdmin, isConfigSuper, isSuper, listAdmins, managersOf, removeAdmin, rolesOf, setGroupRole, setSuper,
  syncConfigSupers, visibleGroups,
} from './roles.js';
import { listGroups } from './store.js';
import { clearCommands, setCommands } from './telegram.js';

const PAGE = 10;
const ROLE_ICON = { view: '👁', manage: '🛠' };
const NEXT_ROLE = { none: 'view', view: 'manage', manage: 'none' };

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const btn = (text, callback_data) => ({ text, callback_data });
const blank = (text = ' ') => ({ text, disabled: {} });

/** One page of items, clamped: { items, p, pages }. */
function pageOf(all, page) {
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const p = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  return { items: all.slice(p * PAGE, (p + 1) * PAGE), p, pages };
}

/** ◀ 2/5 ▶ row (none when there's one page); `to(n)` is the callback data for page n. */
const pagerRow = (p, pages, to) => (pages > 1 ? [[
  p > 0 ? btn('◀', to(p - 1)) : blank(),
  blank(`${p + 1}/${pages}`),
  p < pages - 1 ? btn('▶', to(p + 1)) : blank(),
]] : []);

/** Short access label for a group button: '♾️', '📅 30d', '⚠️ 2d', '⛔'. */
function badge(status) {
  if (!status) return '⛔';
  if (status.kind === 'lifetime') return '♾️';
  return `${status.daysLeft <= 10 ? '⚠️' : '📅'} ${status.daysLeft}d`;
}

/**
 * { text, parse_mode, reply_markup } for this user's panel, or null if they
 * have no groups and aren't a super admin (they keep the normal private chat).
 */
const URGENT_SHOWN = 5;
const groupButton = (r) =>
  btn(`🏪 ${r.group.name ?? r.group.tgId}  ${badge(r.status)}${r.role === 'view' ? ' · 👁' : ''}`, `GROUP_${r.group.tgId}`);

/** The user's groups with their access, and those expired or ending within 10 days, most urgent first. */
async function groupsWithStatus(user) {
  const rows = [];
  for (const v of await visibleGroups(user)) rows.push({ ...v, status: await accessStatus(v.group) });
  const urgent = rows
    .filter((r) => !r.status || (r.status.kind !== 'lifetime' && r.status.daysLeft <= 10))
    .sort((a, b) => (a.status?.daysLeft ?? -1) - (b.status?.daysLeft ?? -1));
  return { rows, urgent };
}

export async function adminPanel(user, page = 0) {
  const superAdmin = await isSuper(user);
  const { rows, urgent } = await groupsWithStatus(user);
  if (!superAdmin && !rows.length) return null;

  const lines = [`🛠 <b>ក្រុម (${rows.length})</b>`];
  if (urgent.length) {
    // Only the most urgent few in the text (a message holds 4,096 characters); the rest are a tap away.
    lines.push('', `⚠️ <b>ផុតកំណត់ ឬជិតផុតកំណត់ (${urgent.length}):</b>`);
    for (const r of urgent.slice(0, URGENT_SHOWN)) {
      const end = r.status ? dayOf(r.status.end) : null;
      lines.push(`• ${escape(r.group.name ?? r.group.tgId)} — ${end ? `${pad2(end.d)}/${pad2(end.m)} · នៅសល់ ${r.status.daysLeft} ថ្ងៃ` : 'ផុតកំណត់'}`);
    }
    if (urgent.length > URGENT_SHOWN) lines.push(`… +${urgent.length - URGENT_SHOWN} ទៀត`);
  }
  if (!rows.length) lines.push('', 'មិនទាន់មានក្រុមទេ។ បញ្ចូល bot ទៅក្នុងក្រុម ហើយចុច /sync → Sync only group។');
  else lines.push('', 'ជ្រើសរើសក្រុម:');

  const { items, p, pages } = pageOf(rows, page);
  const keyboard = items.map((r) => [groupButton(r)]);
  keyboard.push(...pagerRow(p, pages, (n) => `ADMIN_P_${n}`));
  if (urgent.length) keyboard.push([btn(`⚠️ ផុតកំណត់ (${urgent.length})`, 'ADMIN_URG_0')]);
  if (superAdmin) keyboard.push([btn('👥 អ្នកគ្រប់គ្រង', 'TEAM')]);
  keyboard.push([btn('🔄', `ADMIN_P_${p}`), btn('បិទ', 'CLOSE')]);
  return { text: lines.join('\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
}

/** Only the expired and ending-soon groups, paged. */
export async function urgentPanel(user, page = 0) {
  const { rows, urgent } = await groupsWithStatus(user);
  if (!(await isSuper(user)) && !rows.length) return null;
  const { items, p, pages } = pageOf(urgent, page);
  return {
    text: `⚠️ <b>ផុតកំណត់ ឬជិតផុតកំណត់ (${urgent.length})</b>\n\nជ្រើសរើសក្រុម:`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        ...items.map((r) => [groupButton(r)]),
        ...pagerRow(p, pages, (n) => `ADMIN_URG_${n}`),
        [btn('⬅️ ត្រឡប់ក្រោយ', 'ADMIN_HOME')],
      ],
    },
  };
}

const displayName = (a) => a.name ?? (a.username ? `@${a.username}` : String(a.userId));

/** 'Dara (@dara)' where the name opens their Telegram profile when tapped. */
const profile = (a) =>
  `<a href="tg://user?id=${a.userId}">${escape(displayName(a))}</a>${a.username && a.name ? ` (@${escape(a.username)})` : ''}`;

/** The admin list (super admins only); admins are paged, super admins (few) always shown. */
async function teamScreen(page = 0) {
  await syncConfigSupers();
  const everyone = await listAdmins();
  const supers = everyone.filter((a) => a.isSuper);
  const team = everyone.filter((a) => !a.isSuper);
  const lines = [`👥 <b>អ្នកគ្រប់គ្រង</b>`, '', `<b>⭐ Super admin (${supers.length})</b>`];
  const keyboard = [];
  for (const a of supers) {
    lines.push(`• ${profile(a)}${isConfigSuper(a.userId) ? ' · config' : ''}`);
    if (!isConfigSuper(a.userId)) keyboard.push([btn(`⚙️ ⭐ ${displayName(a)}`, `TEAM_${a.userId}`)]);
  }
  lines.push('', `<b>👤 អ្នកគ្រប់គ្រង (${team.length})</b>`);
  const { items, p, pages } = pageOf(team, page);
  for (const a of items) {
    const roles = [...(await rolesOf(a.userId)).values()];
    const count = (r) => roles.filter((x) => x === r).length;
    lines.push(`• ${profile(a)} · 👁 ${count('view')} · 🛠 ${count('manage')}`);
    keyboard.push([btn(`⚙️ ${displayName(a)}`, `TEAM_${a.userId}`)]);
  }
  keyboard.push(...pagerRow(p, pages, (n) => `TEAM_P_${n}`));
  lines.push('', team.length ? 'ចុចឈ្មោះខាងលើ ដើម្បីបើក profile · ចុចប៊ូតុង ⚙️ ដើម្បីកំណត់ក្រុម' : 'មិនទាន់មានអ្នកគ្រប់គ្រងទេ។ ចុច ➕ ដើម្បីបន្ថែម។');
  keyboard.push([btn('➕ បន្ថែម', 'TEAMADD')]);
  keyboard.push([btn('⬅️ ត្រឡប់ក្រោយ', 'ADMIN_HOME')]);
  return { text: lines.join('\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
}

/** One admin: tap a group to cycle — none → 👁 view → 🛠 manage → none. Groups are paged A–Z; their assigned groups are listed in the text. */
export async function teamMemberScreen(userId, page = 0) {
  const a = await getAdmin(userId);
  if (!a) return teamScreen();
  const lines = [`👤 <b>${profile(a)}</b> · <code>${a.userId}</code>`, ''];
  const keyboard = [];
  if (isConfigSuper(userId)) {
    // Bootstrap super admins: changed only in config.js.
    lines.push('⭐ Super admin (config) — គ្រប់ក្រុម និងគ្រប់សិទ្ធិ');
    keyboard.push([btn('⬅️ ត្រឡប់ក្រោយ', 'TEAM')]);
    return { text: lines.join('\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
  }
  keyboard.push([btn(a.isSuper ? '⭐ Super admin: ON' : '☆ Super admin: OFF', `TEAMSUP_${userId}`)]);
  if (a.isSuper) {
    lines.push('⭐ Super admin — គ្រប់ក្រុម និងគ្រប់សិទ្ធិ (រួមទាំងគ្រប់គ្រងអ្នកគ្រប់គ្រង)');
  } else {
    const roles = await rolesOf(userId);
    const all = await listGroups(); // A–Z, so a tapped group stays on its page
    lines.push(
      'ចុចលើក្រុម ដើម្បីប្តូរ: — គ្មាន → 👁 មើល → 🛠 គ្រប់គ្រង',
      '👁 មើលរបាយការណ៍ក្នុង chat ផ្ទាល់ · 🛠 + Sync, Renew, History',
    );
    // Their groups in the text, so they're visible whatever page the buttons are on.
    const assigned = all.filter((g) => roles.has(g.id));
    lines.push('', `<b>ក្រុមដែលបានកំណត់ (${assigned.length}/${all.length}):</b>`);
    for (const g of assigned.slice(0, 15)) lines.push(`${ROLE_ICON[roles.get(g.id)]} ${escape(g.name ?? g.tgId)}`);
    if (assigned.length > 15) lines.push(`… +${assigned.length - 15} ទៀត`);
    if (!assigned.length) lines.push('—');
    const { items, p, pages } = pageOf(all, page);
    for (const g of items) {
      const role = roles.get(g.id);
      keyboard.push([btn(`${role ? ROLE_ICON[role] : '—'}  ${g.name ?? g.tgId}`, `TEAMG_${userId}_${g.id}_${p}`)]);
    }
    keyboard.push(...pagerRow(p, pages, (n) => `TEAMPG_${userId}_${n}`));
    if (!all.length) lines.push('', 'មិនទាន់មានក្រុមទេ។');
  }
  keyboard.push([btn('🗑 លុប', `TEAMDEL_${userId}`), btn('⬅️ ត្រឡប់ក្រោយ', 'TEAM')]);
  return { text: lines.join('\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
}

/** The 'add admin' prompt: Telegram's own user picker, as a one-time reply keyboard. */
const addPrompt = (chatId) => api.sendMessage({
  chat_id: chatId,
  text: '👤 ចុចប៊ូតុងខាងក្រោម ហើយជ្រើសរើសអ្នកប្រើ ដើម្បីបន្ថែមជាអ្នកគ្រប់គ្រង។',
  reply_markup: {
    keyboard: [[{
      text: '👤 ជ្រើសរើសអ្នកប្រើ',
      request_users: { request_id: 1, user_is_bot: false, max_quantity: 1, request_name: true, request_username: true },
    }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
});

/**
 * Team buttons (super admins, private chat): TEAM, TEAM_P_<page>, TEAM_<user>,
 * TEAMPG_<user>_<page>, TEAMADD, TEAMG_<user>_<group row id>_<page> (cycle
 * role), TEAMSUP_<user> (toggle super), TEAMDEL_<user> and TEAMDEL!_<user>.
 */
export async function handleTeam(data, chatId, show) {
  const showScreen = (s) => show(s.text, { parse_mode: s.parse_mode, reply_markup: s.reply_markup });
  if (data === 'TEAM') return showScreen(await teamScreen());
  if (data === 'TEAMADD') return addPrompt(chatId);

  let m = /^TEAM_P_(\d+)$/.exec(data);
  if (m) return showScreen(await teamScreen(Number(m[1])));

  m = /^TEAM_(\d+)$/.exec(data);
  if (m) return showScreen(await teamMemberScreen(Number(m[1])));

  m = /^TEAMPG_(\d+)_(\d+)$/.exec(data);
  if (m) return showScreen(await teamMemberScreen(Number(m[1]), Number(m[2])));

  m = /^TEAMG_(\d+)_(\d+)(?:_(\d+))?$/.exec(data);
  if (m) {
    const [userId, groupId, page] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    if (!(await getAdmin(userId))) return showScreen(await teamScreen());
    const before = (await rolesOf(userId)).get(groupId) ?? 'none';
    const after = NEXT_ROLE[before];
    await setGroupRole(userId, groupId, after === 'none' ? null : after);
    // Managers see /sync in that group's command list.
    const group = (await listGroups()).find((g) => g.id === groupId);
    if (group && after === 'manage') await setCommands(group.tgId, await managersOf(groupId));
    if (group && before === 'manage') await clearCommands(group.tgId, userId);
    return showScreen(await teamMemberScreen(userId, page));
  }

  m = /^TEAMSUP_(\d+)$/.exec(data);
  if (m) {
    const userId = Number(m[1]);
    const a = await getAdmin(userId);
    if (a && !isConfigSuper(userId)) await setSuper(userId, !a.isSuper);
    return showScreen(await teamMemberScreen(userId));
  }

  m = /^TEAMDEL_(\d+)$/.exec(data);
  if (m) {
    const a = await getAdmin(Number(m[1]));
    if (!a || isConfigSuper(a.userId)) return showScreen(await teamScreen());
    return show(`🗑 លុប ${escape(displayName(a))} ពីអ្នកគ្រប់គ្រង? គាត់នឹងបាត់សិទ្ធិទាំងអស់។`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[btn('✅ លុប', `TEAMDEL!_${a.userId}`), btn('⬅️ ទេ', `TEAM_${a.userId}`)]] },
    });
  }

  m = /^TEAMDEL!_(\d+)$/.exec(data);
  if (m) {
    const userId = Number(m[1]);
    if (isConfigSuper(userId)) return showScreen(await teamScreen());
    const roles = await rolesOf(userId);
    for (const g of await listGroups()) if (roles.get(g.id) === 'manage') await clearCommands(g.tgId, userId);
    await removeAdmin(userId);
    return showScreen(await teamScreen());
  }
}
