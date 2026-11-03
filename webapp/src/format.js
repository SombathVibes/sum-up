// Formatting shared by the screens. Amounts arrive in hundredths; dates are
// unix seconds or 'YYYY-MM-DD' Phnom Penh days, as the bot stores them.

const OFFSET = 7 * 3600; // Phnom Penh, UTC+7
const pad2 = (n) => String(n).padStart(2, '0');

export function money(cents) {
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '');
  return (cents < 0 ? '-' : '') + whole + (frac ? `.${frac}` : '');
}

export const amount = (cents, currency) => (currency === 'USD' ? `$${money(cents)}` : `៛${money(cents)}`);

/** Today in Phnom Penh as 'YYYY-MM-DD'. */
export function todayKey() {
  const d = new Date(Date.now() + OFFSET * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function monthBounds(key, delta = 0) {
  const [y, m] = key.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(y, m + delta, 0));
  const k = (t) => `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  return { from: k(first), to: k(last) };
}

/** '2026-11-03' → '03/11' */
export const shortDay = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** unix seconds → '03/11/2026' (Phnom Penh) */
export function dateOf(ts) {
  const d = new Date((ts + OFFSET) * 1000);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** unix seconds → '05:06PM' (Phnom Penh) */
export function timeOf(ts) {
  const d = new Date((ts + OFFSET) * 1000);
  const h = d.getUTCHours();
  return `${pad2(h % 12 || 12)}:${pad2(d.getUTCMinutes())}${h >= 12 ? 'PM' : 'AM'}`;
}

/** '+18%' / '-5%' / null when there's nothing to compare with. */
export function change(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** The group's access as a short badge: { text, tone }. */
export function accessBadge(status) {
  if (!status) return { text: 'ផុតកំណត់', tone: 'bad' };
  if (status.kind === 'lifetime') return { text: '♾️ អចិន្ត្រៃយ៍', tone: 'ok' };
  if (status.daysLeft <= 10) return { text: `⚠️ ${status.daysLeft} ថ្ងៃ`, tone: 'warn' };
  return { text: `${status.daysLeft} ថ្ងៃ`, tone: 'ok' };
}
