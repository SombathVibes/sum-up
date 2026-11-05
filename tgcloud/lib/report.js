// Report screens as { text, rich } (lib/rich.js). Amounts arrive in hundredths.

import { WHITELIST_BOTS } from './config.js';
import { addDays, dayKey, dayOf, formatTime, now, pad2 } from './dates.js';
import { col, Doc, time } from './rich.js';

const CURRENCIES = ['KHR', 'USD'];

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 123456 → '1,234.56', 400000 → '4,000'. Hand-rolled: the runtime may lack Intl. */
export function money(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '');
  return sign + whole + (frac ? `.${frac}` : '');
}

/** Who asked for the report, as a link to their profile: '@sombath' or their first name. */
function byName(user) {
  if (!user?.id) return 'មិនស្គាល់';
  const label = user.username ? `@${user.username}` : user.first_name ?? 'មិនស្គាល់';
  return `<a href="tg://user?id=${user.id}">${escapeHtml(label)}</a>`;
}

const WEEKDAYS = ['អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
const SYMBOL = { KHR: '៛', USD: '$' };
const botName = (id) => WHITELIST_BOTS[id] ?? String(id);

/** Per bank and overall: { bots: [{ name, ops, first, last, KHR, USD }], total: { ops, KHR, USD } }. */
function summarize(rows) {
  const bots = new Map();
  const total = { ops: 0, KHR: 0, USD: 0 };
  for (const r of rows) {
    if (!bots.has(r.botTgId)) bots.set(r.botTgId, { name: botName(r.botTgId), ops: 0, first: r.first, last: r.last, KHR: 0, USD: 0 });
    const b = bots.get(r.botTgId);
    b.ops += r.ops;
    b[r.currency] += r.total;
    b.first = Math.min(b.first, r.first);
    b.last = Math.max(b.last, r.last);
    total.ops += r.ops;
    total[r.currency] += r.total;
  }
  return { bots: [...bots.values()].sort((a, b) => a.first - b.first), total };
}

// Only the currencies that actually came in: '៛ <b>109,700</b>'.
const amounts = (x) => CURRENCIES.filter((c) => x[c]).map((c) => `${SYMBOL[c]} <b>${money(x[c])}</b>`);

/**
 * Day comparison lines: vs the day before and vs the same weekday last week.
 * compare: { yesterday, lastWeek } as totalsByBot rows; a line is left out when
 * that day had nothing in any currency this day has.
 */
function dayComparison(total, weekday, compare) {
  const versus = (label, rows) => {
    if (!rows) return null;
    const prev = summarize(rows).total;
    const parts = CURRENCIES
      .map((c) => [c, change(total[c], prev[c])])
      .filter(([, v]) => v)
      .map(([c, v]) => `${SYMBOL[c]} ${v}`);
    return parts.length ? `${label}: ${parts.join(' · ')}` : null;
  };
  return [versus('ធៀបម្សិលមិញ', compare.yesterday), versus(`ធៀបថ្ងៃ${weekday}មុន`, compare.lastWeek)].filter(Boolean);
}

/** Who asked and when: the reader sees the time in their own time zone. */
const footer = (doc, user) => doc.line(`<i>🕔 ${time(now(), formatTime(now()))} · ${byName(user)}</i>`);

/**
 * One day as cards (🗂 កាត): a block per bank (payments, time span, amounts),
 * a total when there's more than one bank, then the payments folded and the
 * comparison lines.
 * rows: [{ botTgId, currency, total, ops, first, last }]
 * recent: [{ date, amount, currency, botTgId }], newest first
 */
export function dayReport(day, rows, user, recent = [], compare = {}) {
  const weekday = WEEKDAYS[new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()];
  const { bots, total } = summarize(rows);

  const doc = new Doc().title(`📊 របាយការណ៍ ថ្ងៃ${weekday} ${pad2(day.d)}/${pad2(day.m)}/${day.y}`).line('');
  if (!bots.length) doc.line('មិនទាន់មានប្រតិបត្តិការទេ។').line('');
  for (const b of bots) {
    doc.line(`<b>🏦 ${escapeHtml(b.name)}</b> · ${b.ops} ប្រតិ. · ${formatTime(b.first)}–${formatTime(b.last)}`);
    for (const a of amounts(b)) doc.line(a);
    doc.line('');
  }
  if (bots.length > 1) {
    doc.rule().bold(`💰 សរុប · ${total.ops} ប្រតិបត្តិការ`);
    for (const a of amounts(total)) doc.line(a);
    doc.line('');
  }
  paymentsTable(doc, recent, total.ops);
  for (const l of dayComparison(total, weekday, compare)) doc.line(l);
  return footer(doc, user).out();
}

// The day table: bank, payments, KHR and USD.
const BANK_COLS = [col('ធនាគារ', 'Bank', 10), col('ប្រតិ.', 'Ops', 6), col('រៀល', 'KHR', 15), col('ដុល្លារ', 'USD', 12)];

/**
 * One day as a table (📋 តារាង, the default), one row per bank plus a total;
 * no USD column on a day without dollar payments.
 */
export function dayTable(day, rows, user, compare = {}) {
  const weekday = WEEKDAYS[new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()];
  const { bots, total } = summarize(rows);
  const usd = total.USD !== 0;
  const cols = usd ? BANK_COLS : BANK_COLS.slice(0, 3);
  const cells = (name, ops, x) => [name, String(ops), money(x.KHR), money(x.USD)].slice(0, cols.length);
  const doc = new Doc().title(`📊 របាយការណ៍ ថ្ងៃ${weekday} ${pad2(day.d)}/${pad2(day.m)}/${day.y}`);
  if (bots.length) doc.table(cols, bots.map((b) => cells(b.name.slice(0, 10), b.ops, b)), { total: cells('Total', total.ops, total) });
  else doc.line('មិនទាន់មានប្រតិបត្តិការទេ។');
  for (const l of dayComparison(total, weekday, compare)) doc.line(l);
  return footer(doc, user).out();
}

// The day's payments: time, amount, bank.
const PAYMENT_COLS = [col('ម៉ោង', 'Time', 9), col('ចំនួន', 'Amount', 13), col('ធនាគារ', 'Bank', 9, true)];

/** The day's payments in a folded table; the store caps the list (100), which the title says when the day has more. */
function paymentsTable(doc, recent, ops) {
  if (!recent.length) return;
  const title = recent.length < ops ? `🧾 ប្រតិបត្តិការចុងក្រោយ ${recent.length}/${ops}` : `🧾 ប្រតិបត្តិការទាំងអស់ (${ops})`;
  doc.table(PAYMENT_COLS, recent.map((p) => [formatTime(p.date), `${SYMBOL[p.currency]}${money(p.amount)}`, `  ${botName(p.botTgId)}`]), { fold: title });
}

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const dotIfZero = (v, f = String) => (v ? f(v) : '·');

/** Signed percent change, or null when there's nothing to compare against. */
function change(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? '↗️ +' : pct < 0 ? '↘️ ' : '→ '}${pct}%`;
}

/**
 * A week or month as a monospace table plus a short summary.
 * data.days: totalsByDay rows (already filtered to `bank` if set)
 * data.bots: totalsByBot rows for the range; data.prev: totalsByBot rows for the
 *   period before it (same length), for the comparison line
 * opts.month: a month report (one row per Monday-to-Sunday week unless
 *   opts.daily; a week has one per day); opts.bank: one bank only
 */
export function rangeReport(range, data, user, { month = false, daily = false, bank = null } = {}) {
  const first = dayOf(range.start);
  const last = dayOf(range.end);

  // Totals per calendar day in the range.
  const days = [];
  const byKey = new Map();
  for (let d = first; dayKey(d) <= dayKey(last); d = addDays(d, 1)) {
    const entry = { day: d, ops: 0, KHR: 0, USD: 0 };
    byKey.set(dayKey(d), entry);
    days.push(entry);
  }
  for (const r of data.days) {
    const entry = byKey.get(r.day);
    if (!entry || !(r.currency in entry)) continue;
    entry[r.currency] += r.total;
    entry.ops += r.ops;
  }

  // Table rows: one per day, or (month, default) one per Monday-to-Sunday week.
  let rows;
  if (month && !daily) {
    rows = [];
    for (const e of days) {
      if (!rows.length || weekdayOf(e.day) === 1) rows.push({ from: e.day, to: e.day, ops: 0, KHR: 0, USD: 0 });
      const w = rows[rows.length - 1];
      w.to = e.day;
      w.ops += e.ops;
      w.KHR += e.KHR;
      w.USD += e.USD;
    }
    rows = rows.map((w) => ({ ...w, label: `${pad2(w.from.d)}–${pad2(w.to.d)}` }));
  } else {
    rows = days.map((e) => ({ ...e, label: `${EN_WEEKDAYS[weekdayOf(e.day)]} ${pad2(e.day.d)}` }));
  }

  const sum = days.reduce((t, e) => ({ ops: t.ops + e.ops, KHR: t.KHR + e.KHR, USD: t.USD + e.USD }), { ops: 0, KHR: 0, USD: 0 });
  // No dollar payments in the range: leave the USD column out.
  const usd = sum.USD !== 0;
  const cols = [
    month && !daily ? col('សប្ដាហ៍', 'Week', 10) : col('ថ្ងៃ', 'Day', 10),
    ...BANK_COLS.slice(1, usd ? 4 : 3),
  ];
  const cells = (label, ops, khr, usdCell) => [label, ops, khr, usdCell].slice(0, cols.length).map(String);

  const bankLabel = bank ? ` · ${escapeHtml(botName(bank))}` : '';
  const title = month
    ? `📊 ខែ ${pad2(first.m)}/${first.y}${bankLabel}`
    : `📊 សប្ដាហ៍ ${pad2(first.d)}/${pad2(first.m)} – ${pad2(last.d)}/${pad2(last.m)}/${last.y}${bankLabel}`;

  const doc = new Doc().title(title).table(cols, rows.map((r) => cells(r.label, dotIfZero(r.ops), dotIfZero(r.KHR, money), dotIfZero(r.USD, money))), {
    total: cells('Total', sum.ops, money(sum.KHR), money(sum.USD)),
  });

  // One line per bank (only the filtered bank when filtering).
  const plain = (x) => CURRENCIES.filter((c) => x[c]).map((c) => `${SYMBOL[c]}${money(x[c])}`);
  const { bots } = summarize(bank ? data.bots.filter((r) => r.botTgId === bank) : data.bots);
  for (const b of bots) doc.line(`🏦 ${escapeHtml(b.name)} ${b.ops} · ${plain(b).join(' · ')}`);

  const active = days.filter((e) => e.ops);
  if (active.length) {
    const best = active.reduce((a, e) => (e.ops > a.ops ? e : a));
    doc.line(`📈 ថ្ងៃច្រើនបំផុត: ${EN_WEEKDAYS[weekdayOf(best.day)]} ${pad2(best.day.d)}/${pad2(best.day.m)} · ${best.ops} ប្រតិ. · ${plain(best).join(' · ')}`);
  }
  if (month) {
    const avg = { KHR: active.length ? sum.KHR / active.length : 0, USD: active.length ? sum.USD / active.length : 0 };
    const avgText = plain(avg).join(' · ');
    doc.line(`📅 មានប្រតិបត្តិការ ${active.length}/${days.length} ថ្ងៃ${avgText ? ` · មធ្យម ${avgText}/ថ្ងៃ` : ''}`);
  }

  const prev = summarize(bank ? data.prev.filter((r) => r.botTgId === bank) : data.prev).total;
  const changes = CURRENCIES
    .map((c) => [c, change(sum[c], prev[c])])
    .filter(([, v]) => v)
    .map(([c, v]) => `${SYMBOL[c]} ${v}`);
  if (changes.length) doc.line(`ធៀប${month ? 'ខែមុន' : 'សប្ដាហ៍មុន'}: ${changes.join(' · ')}`);

  return footer(doc, user).out();
}
