// Inline keyboards. Callback data carries everything needed to answer a press,
// so no session state is stored between clicks.

import {
  addDays, addMonths, dayKey, dayOf, formatDayMonth, monthKey, monthRange, pad2, startOf, weekRange,
} from './dates.js';

const btn = (text, data) => ({ text, callback_data: data });
// A greyed-out button that does nothing (Bot API 10.3).
const blank = (text = ' ') => ({ text, disabled: {} });
const keyboard = (rows) => ({ inline_keyboard: rows.filter((r) => r.length) });
const BACK = [btn('ត្រឡប់ក្រោយ', 'BACK')];

export const MENU_TEXT = 'ជ្រើសរើសរបាយការណ៍:';

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
  [btn('ប្រចាំថ្ងៃ', 'DAILY')],
  [btn('ប្រចាំសប្ដាហ៍', 'WEEKLY')],
  [btn('ប្រចាំខែ', 'MONTHLY')],
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

export function dailyMenu(today) {
  const older = [2, 3, 4, 5].map((i) => {
    const day = addDays(today, -i);
    return btn(formatDayMonth(day), `DATE_${dayKey(day)}`);
  });
  return {
    text: 'ជ្រើសរើសថ្ងៃ:',
    reply_markup: keyboard([
      [btn('ថ្ងៃនេះ', 'TODAY'), btn('ម្សិលមិញ', 'YESTERDAY')],
      ...chunk(older, 2),
      [btn('📅 ប្រតិទិន', `CAL_${monthKey(today)}`)],
      BACK,
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
      [btn('⬅️ ត្រឡប់ក្រោយ', 'DAILY')],
    ]),
  };
}

export function weeklyMenu(today) {
  const older = [2, 3, 4, 5].map((i) => {
    const { start, end } = weekRange(addDays(today, -7 * i));
    const first = dayOf(start);
    return btn(`${formatDayMonth(first)} - ${formatDayMonth(dayOf(end))}`, `WEEK_${dayKey(first)}`);
  });
  return {
    text: 'ជ្រើសរើសសប្ដាហ៍:',
    reply_markup: keyboard([
      [btn('សប្ដាហ៍នេះ', 'THIS_WEEK'), btn('សប្ដាហ៍មុន', 'LAST_WEEK')],
      ...chunk(older, 2),
      BACK,
    ]),
  };
}

export function monthlyMenu(today) {
  const older = [2, 3, 4].map((i) => {
    const month = addMonths(today, -i);
    return btn(`${pad2(month.m)}-${month.y}`, `MONTH_${monthKey(month)}`);
  });
  return {
    text: 'ជ្រើសរើសខែ:',
    reply_markup: keyboard([
      [btn('ខែនេះ', 'THIS_MONTH'), btn('ខែមុន', 'LAST_MONTH')],
      older,
      [btn('📅 ប្រតិទិនខែ', `YCAL_${today.y}`)],
      BACK,
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
      [btn('⬅️ ត្រឡប់ក្រោយ', 'MONTHLY')],
    ]),
  };
}

/**
 * Report view options carried in callback data after the report key, so
 * Refresh and other buttons keep them: '~c' cards (day reports; the table is
 * the default), '~d' one row per day (month reports; per week is the default),
 * '~b<bank id>' one bank only (week and month reports).
 */
export const viewKey = (key, { cards = false, daily = false, bank = null } = {}) =>
  `${key}${cards ? '~c' : ''}${daily ? '~d' : ''}${bank ? `~b${bank}` : ''}`;

export function parseView(data) {
  const [key, ...flags] = data.split('~');
  const view = { cards: false, daily: false, bank: null };
  for (const f of flags) {
    if (f === 'c') view.cards = true;
    else if (f === 'd') view.daily = true;
    else if (/^b\d+$/.test(f)) view.bank = Number(f.slice(1));
    // 't' (table) is from older messages; the table is the default now.
  }
  return { key, view };
}

/**
 * Under every report: format toggles, a bank filter when the period has more
 * than one bank, Refresh (catch up through the sync helper), and Back.
 */
export function reportKeyboard(key, parent, view, { day = false, month = false, banks = [], bankName = String } = {}) {
  const at = (changes) => viewKey(key, { ...view, ...changes });
  const rows = [];
  if (day) rows.push([view.cards ? btn('📋 តារាង', at({ cards: false })) : btn('🗂 កាត', at({ cards: true }))]);
  if (month) rows.push([view.daily ? btn('🗓 ប្រចាំសប្ដាហ៍', at({ daily: false })) : btn('📆 ប្រចាំថ្ងៃ', at({ daily: true }))]);
  if (!day && banks.length > 1) {
    const mark = (on, text) => (on ? `● ${text}` : text);
    rows.push(...chunk([
      btn(mark(!view.bank, 'ទាំងអស់'), at({ bank: null })),
      ...banks.map((id) => btn(mark(view.bank === id, bankName(id)), at({ bank: id }))),
    ], 3));
  }
  rows.push([btn('🔄 ធ្វើបច្ចុប្បន្នភាព', `${at({})}!`), btn('⬅️ ត្រឡប់ក្រោយ', parent)]);
  return keyboard(rows);
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
