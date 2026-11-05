// Inline keyboards. Callback data carries everything needed to answer a press,
// so no session state is stored between clicks.

import {
  addDays, addMonths, dayKey, dayOf, monthKey, monthRange, pad2, startOf,
} from './dates.js';

const btn = (text, data) => ({ text, callback_data: data });
// A greyed-out button that does nothing (Bot API 10.3).
const blank = (text = ' ') => ({ text, disabled: {} });
const keyboard = (rows) => ({ inline_keyboard: rows.filter((r) => r.length) });
const BACK = [btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')];

export const MENU_TEXT = 'ជ្រើសរើសរបាយការណ៍:';
/** The bank payments report's name. */
export const BANK_REPORT = 'របាយការណ៍ធនាគារ';

// The subscription row appears only when access ends within this many days.
const SUBSCRIBE_ROW_DAYS = 10;

/**
 * The report menu (status from billing.accessStatus). Admins also get a Sync
 * row. The subscription row is hidden for lifetime groups and while more than
 * SUBSCRIBE_ROW_DAYS days remain.
 */
/**
 * The group menu, built for whoever opened it: admin (manager) adds ⚙️ Sync,
 * dailyReport the 📥 lottery report (switched on for the group), agentExcel
 * 📊 Excel ភ្នាក់ងារ (the private admin panel, and the group's report signs in).
 */
export const menuKeyboard = (admin = false, status = null, dailyReport = false, agentExcel = false) => keyboard([
  [btn(`📊 ${BANK_REPORT}`, 'BANK')],
  // Only groups a super admin switched Daily report on for (lib/daily.js).
  dailyReport ? [btn('📥 របាយការណ៍ឆ្នោត', 'DREPORT')] : [],
  !status || (status.kind !== 'lifetime' && status.daysLeft <= SUBSCRIBE_ROW_DAYS) ? [btn('⭐ ការជាវ', 'BILLING')] : [],
  agentExcel ? [btn('📊 Excel ភ្នាក់ងារ', 'XL')] : [],
  admin ? [btn('⚙️ Sync', 'SYNC_MENU')] : [],
  [btn('បិទ', 'CLOSE')],
]);

/**
 * Menu title with the group's access on top (status from billing.accessStatus),
 * e.g. '📅 សុពលភាពដល់ 03/12/2026 · នៅសល់ 29 ថ្ងៃ'; a warning in the last 3 days
 * unless it renews by itself.
 */
export function menuText(status) {
  if (!status) return MENU_TEXT;
  if (status.kind === 'lifetime') return `♾️ អចិន្ត្រៃយ៍\n${MENU_TEXT}`;
  const end = dayOf(status.end);
  const date = `${pad2(end.d)}/${pad2(end.m)}/${end.y}`;
  const left = `នៅសល់ ${status.daysLeft} ថ្ងៃ`;
  let line;
  if (status.kind === 'renewing') line = `🔁 បន្តស្វ័យប្រវត្តិ ${date}`;
  else if (status.daysLeft <= 3) line = `⚠️ ផុតកំណត់ ${date} · ${left} — ចុច ⭐ ការជាវ`;
  else if (status.kind === 'trial') line = `📅 សាកល្បងដល់ ${date} · ${left}`;
  else line = `📅 សុពលភាពដល់ ${date} · ${left}`;
  return `${line}\n${MENU_TEXT}`;
}

/**
 * BANK / BANKWK_<page>: the bank report's day picker, like the 📥 lottery
 * one: today, yesterday and five more days (a week per page, `page` weeks
 * back), • on days with payments (paidDays: Set of 'YYYY-MM-DD'); one tap
 * opens a day. 💰 opens the week and month picker.
 */
export function bankDayPicker(today, page, paidDays) {
  const first = addDays(today, -7 * page);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, -i));
  const label = (d, i) => {
    const mark = paidDays.has(dayKey(d)) ? ' •' : '';
    if (page === 0 && i === 0) return `ថ្ងៃនេះ${mark}`;
    if (page === 0 && i === 1) return `ម្សិលមិញ${mark}`;
    return `${pad2(d.d)}/${pad2(d.m)}${mark}`;
  };
  const buttons = days.map((d, i) => btn(label(d, i), `DATE_${dayKey(d)}`));
  return {
    text: `<b>📊 ${BANK_REPORT}</b>\nជ្រើសរើសថ្ងៃ (• មានប្រតិបត្តិការ):`,
    parse_mode: 'HTML',
    reply_markup: keyboard([
      buttons.slice(0, 2), buttons.slice(2, 5), buttons.slice(5, 7),
      [btn('◀ សប្ដាហ៍មុន', `BANKWK_${page + 1}`), ...(page > 0 ? [btn('សប្ដាហ៍ក្រោយ ▶', `BANKWK_${page - 1}`)] : [])],
      [btn('📅 ប្រតិទិន', `CAL_${monthKey(first)}`)],
      [btn('💰 សរុប (សប្ដាហ៍ · ខែ)', 'BANKTOT')],
      BACK,
    ]),
  };
}

/** BANKTOT: a week (Mon–Sun) or a month, like the lottery 💰 សរុប. */
export function bankPeriodPicker(today) {
  return {
    text: `<b>💰 ${BANK_REPORT} · សរុប</b>\nជ្រើសរើសរយៈពេល:`,
    parse_mode: 'HTML',
    reply_markup: keyboard([
      [btn('សប្ដាហ៍នេះ', 'THIS_WEEK'), btn('សប្ដាហ៍មុន', 'LAST_WEEK')],
      [btn('ខែនេះ', 'THIS_MONTH'), btn('ខែមុន', 'LAST_MONTH')],
      [btn('📅 ប្រតិទិនខែ', `YCAL_${today.y}`)],
      [btn(`📋 ${BANK_REPORT} (ប្រចាំថ្ងៃ)`, 'BANK')],
      [btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')],
    ]),
  };
}

const WEEKDAYS = ['ច', 'អ', 'ព', 'ព្រ', 'សុ', 'ស', 'អា']; // Monday first

/**
 * A month grid. Days with payments (paidDays: Set of 'YYYY-MM-DD') get a dot,
 * today is bracketed, and future days are greyed out. The title opens that
 * month's report; ◀ ▶ page through months.
 */
export function calendarMenu(month, today, paidDays) {
  const isCurrent = month.y === today.y && month.m === today.m;
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const header = [
    btn('◀', `CAL_${monthKey(prev)}`),
    btn(`${pad2(month.m)}-${month.y}`, `CMONTH_${monthKey(month)}`),
    isCurrent ? blank('▶') : btn('▶', `CAL_${monthKey(next)}`),
  ];

  const first = { y: month.y, m: month.m, d: 1 };
  const weekday = new Date(startOf(first) * 1000 + 7 * 3600 * 1000).getUTCDay(); // 0 = Sunday
  const cells = Array.from({ length: (weekday + 6) % 7 }, () => blank());
  const last = dayOf(monthRange(month.y, month.m).end).d;
  const todayKey = dayKey(today);
  for (let d = 1; d <= last; d++) {
    const day = { y: month.y, m: month.m, d };
    const key = dayKey(day);
    if (key > todayKey) { cells.push(blank(String(d))); continue; }
    let label = paidDays.has(key) ? `${d}•` : String(d);
    if (key === todayKey) label = `[${label}]`;
    cells.push(btn(label, `CDATE_${key}`));
  }
  while (cells.length % 7) cells.push(blank());

  return {
    text: 'ជ្រើសរើសថ្ងៃ (• មានប្រតិបត្តិការ):',
    reply_markup: keyboard([
      header,
      WEEKDAYS.map((w) => blank(w)),
      ...chunk(cells, 7),
      [btn('⬅️ ត្រឡប់ក្រោយ', 'BANK')],
    ]),
  };
}

const KHMER_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];

/**
 * A year as a 3×4 grid of months. Months with payments (paidMonths: Set of
 * 'YYYY-MM') get a dot, the current month is bracketed, future months are
 * greyed out; ◀ ▶ page through years.
 */
export function yearCalendarMenu(year, today, paidMonths) {
  const cells = KHMER_MONTHS.map((name, i) => {
    const month = { y: year, m: i + 1 };
    const key = monthKey(month);
    if (key > monthKey(today)) return blank(name);
    let label = paidMonths.has(key) ? `${name}•` : name;
    if (key === monthKey(today)) label = `[${label}]`;
    return btn(label, `YMONTH_${key}`);
  });
  return {
    text: 'ជ្រើសរើសខែ (• មានប្រតិបត្តិការ):',
    reply_markup: keyboard([
      [btn('◀', `YCAL_${year - 1}`), blank(String(year)), year >= today.y ? blank('▶') : btn('▶', `YCAL_${year + 1}`)],
      ...chunk(cells, 3),
      [btn('⬅️ ត្រឡប់ក្រោយ', 'BANKTOT')],
    ]),
  };
}

/**
 * Under every bank report, like the lottery report: ◀ / ▶ the period before
 * and after (▶ only up to today), 🔄 (catch up through the sync helper, then
 * redraw), 📅 back to the day picker (a day) or the week/month picker, and
 * Back to the menu. Keys are absolute (DATE_ / WEEK_ / MONTH_), so a button
 * means the same period tomorrow.
 */
export function reportKeyboard(key, prev, next, { day = false } = {}) {
  return keyboard([
    [btn('◀', prev), btn('🔄 ទាញថ្មី', `${key}!`), ...(next ? [btn('▶', next)] : [])],
    [day ? btn('📅 ថ្ងៃផ្សេង', 'BANK') : btn('📅 រយៈពេលផ្សេង', 'BANKTOT'), btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')],
  ]);
}

/** The sync menu; the Lifetime switch is for super admins only. */
export const syncMenu = (lifetime = false, superAdmin = true) => ({
  text: 'Welcome to Sync ✋\nChoose an option:',
  reply_markup: keyboard([
    [btn('📂 Sync only group', 'SYNC_GROUP')],
    [btn('📅 Sync today', 'SYNC_TODAY')],
    [btn('📆 Sync this week', 'SYNC_WEEK')],
    [btn('🗓️ Sync this year', 'SYNC_YEAR')],
    [btn('🔄 Renew', 'RENEW'), btn('🧾 History', 'HISTORY')],
    superAdmin ? [btn(lifetime ? '♾️ Lifetime: ON' : '♾️ Lifetime: OFF', 'LIFETIME')] : [],
    [btn('⬅️ ត្រឡប់ក្រោយ', 'BACK'), btn('បិទ', 'CLOSE')],
  ]),
});

export const RENEW_MONTHS = [1, 3, 6, 12];

/** Admin: how many months the customer paid for (priceLabel(months) → '$15'). */
export const renewMenu = (groupName, endLabel, priceLabel) => ({
  text: `🔄 Record a payment for "${groupName}"\nCurrent period ends: ${endLabel}\n\nHow many months did they pay for?`,
  reply_markup: keyboard([
    RENEW_MONTHS.map((m) => btn(`${m} ខែ · ${priceLabel(m)}`, `RENEW_${m}`)).slice(0, 2),
    RENEW_MONTHS.map((m) => btn(`${m} ខែ · ${priceLabel(m)}`, `RENEW_${m}`)).slice(2),
    [btn('⬅️ ត្រឡប់ក្រោយ', 'SYNC_MENU')],
  ]),
});

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
