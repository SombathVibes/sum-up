// Calendar math in Phnom Penh time (UTC+7, no DST). A "day" is { y, m, d }
// with m 1-based; ranges are { start, end } in unix seconds, end inclusive.

const OFFSET = 7 * 3600;
const DAY = 86400;

const pad2 = (n) => String(n).padStart(2, '0');

/** The Phnom Penh calendar day containing a unix timestamp. */
export function dayOf(ts) {
  const d = new Date((ts + OFFSET) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export const now = () => Math.floor(Date.now() / 1000);
export const today = () => dayOf(now());

/** Unix seconds at Phnom Penh midnight starting this day (normalizes overflow). */
export function startOf({ y, m, d }) {
  return Date.UTC(y, m - 1, d) / 1000 - OFFSET;
}

export const addDays = (day, n) => dayOf(startOf(day) + n * DAY);

export const dayRange = (day) => ({ start: startOf(day), end: startOf(day) + DAY - 1 });

/** Monday-to-Sunday week containing the day. */
export function weekRange(day) {
  const weekday = new Date(startOf(day) * 1000 + OFFSET * 1000).getUTCDay(); // 0 = Sunday
  const monday = addDays(day, weekday === 0 ? -6 : 1 - weekday);
  return { start: startOf(monday), end: startOf(addDays(monday, 7)) - 1 };
}

export function monthRange(y, m) {
  return { start: startOf({ y, m, d: 1 }), end: startOf({ y, m: m + 1, d: 1 }) - 1 };
}

export function yearRange(y) {
  return { start: startOf({ y, m: 1, d: 1 }), end: startOf({ y: y + 1, m: 1, d: 1 }) - 1 };
}

/** Adds months to a { y, m } pair. */
export function addMonths({ y, m }, n) {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

/** 'YYYY-MM-DD' ↔ day. */
export const dayKey = ({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`;
export function parseDayKey(s) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return p ? { y: +p[1], m: +p[2], d: +p[3] } : null;
}

/** 'YYYY-MM' ↔ { y, m }. */
export const monthKey = ({ y, m }) => `${y}-${pad2(m)}`;
export function parseMonthKey(s) {
  const p = /^(\d{4})-(\d{2})$/.exec(s);
  return p ? { y: +p[1], m: +p[2] } : null;
}

/** 'ថ្ងៃទី 03 ខែ 11 ឆ្នាំ 2026' */
export const formatKhmerDate = ({ y, m, d }) => `ថ្ងៃទី ${pad2(d)} ខែ ${pad2(m)} ឆ្នាំ ${y}`;

/** '09:05AM' in Phnom Penh time. */
export function formatTime(ts) {
  const d = new Date((ts + OFFSET) * 1000);
  const h = d.getUTCHours();
  return `${pad2(h % 12 || 12)}:${pad2(d.getUTCMinutes())}${h >= 12 ? 'PM' : 'AM'}`;
}

/** '03/11' */
export const formatDayMonth = ({ m, d }) => `${pad2(d)}/${pad2(m)}`;

export { pad2 };
