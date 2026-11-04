// Daily report: per group (off by default, super admins switch it on), the bot
// calls the group's URL at each of its times, saves the response, and posts it
// in the group.
//
// Telegram Serverless has no timer, so the sync helper's cron (sync-helper/)
// sends /dailyrun to the bot as the helper's user account (a super admin) at
// each scheduled minute; pushSchedule() tells the helper which minutes those
// are. /dailyrun runs, for every enabled group, its latest time that has passed
// today if that time has no report yet, so a missed minute catches up on the
// next trigger (earlier missed times are skipped, not run in a burst).

import { api, db, fetch } from 'sdk';
import { and, desc, eq, gte, lt, lte } from 'sdk/db';
import { reportSources, reportSnapshots } from '../schema.js';
import { SYNC_HELPER_SECRET, SYNC_HELPER_URL } from './config.js';
import { addDays, dayKey, formatTime, now, pad2, parseDayKey, today } from './dates.js';
import { listGroups } from './store.js';

const OFFSET = 7 * 3600; // Phnom Penh, UTC+7
const MAX_BODY = 300_000; // other APIs' replies; cut JSON can't be laid out
const KEEP_DAYS = 7; // older days are fetched again when picked
const TIMEOUT_MS = 20_000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 24;

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'HH:MM' now in Phnom Penh. */
export function nowHHMM() {
  const d = new Date((now() + OFFSET) * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const DEFAULTS = { enabled: false, url: '', times: '21:00', postToGroup: true, authType: 'none', loginUrl: '', username: '', password: '', tokenField: '', basicAuth: '', headers: '' };

const parseTimes = (s) => String(s ?? '').split(',').filter((t) => TIME.test(t));

/**
 * A stored row (or the defaults) as a config. Without `secret` the password is
 * left out and only `hasPassword` says whether one is saved (for the Mini App).
 */
function toConfig(row, secret) {
  const r = row ?? DEFAULTS;
  const cfg = {
    enabled: !!r.enabled,
    url: r.url,
    url2: r.url2 ?? '',
    times: parseTimes(r.times),
    postToGroup: !!r.postToGroup,
    authType: r.authType === 'login' ? 'login' : 'none',
    loginUrl: r.loginUrl ?? '',
    username: r.username ?? '',
    tokenField: r.tokenField ?? '',
    hasPassword: !!r.password,
    // The Basic value is a client id/secret, shown so it can be checked; the password never is.
    basicAuth: r.basicAuth ?? '',
    hasBasicAuth: !!r.basicAuth,
    headers: r.headers ?? '',
  };
  if (secret) Object.assign(cfg, { password: r.password ?? '', token: r.token ?? '' });
  return cfg;
}

/** A group's config, or the defaults (off). groupId is groups.id. `secret`: include the password (only for running it). */
export async function dailyConfig(groupId, { secret = false } = {}) {
  const row = await db.select().from(reportSources).where(eq(reportSources.groupId, groupId)).get();
  return toConfig(row, secret);
}

/** Checks new values: { values } or { error } naming the bad field. */
export function checkDaily(input) {
  const enabled = !!input.enabled;
  const url = String(input.url ?? '').trim();
  const list = Array.isArray(input.times) ? input.times.map(String) : [];
  if (url && (!/^https?:\/\/\S+$/.test(url) || url.length > 1000)) return { error: 'url' };
  if (enabled && !url) return { error: 'url' };
  const url2 = String(input.url2 ?? '').trim();
  if (url2 && (!/^https?:\/\/\S+$/.test(url2) || url2.length > 1000)) return { error: 'url2' };
  if (!list.length || list.length > MAX_TIMES || !list.every((t) => TIME.test(t))) return { error: 'times' };
  const times = [...new Set(list)].sort();
  const values = { enabled, url, url2, times, postToGroup: input.postToGroup !== false, authType: 'none', loginUrl: '', username: '', tokenField: '' };
  if (input.authType === 'login') {
    const loginUrl = String(input.loginUrl ?? '').trim();
    const username = String(input.username ?? '').trim();
    const tokenField = String(input.tokenField ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(loginUrl) || loginUrl.length > 1000) return { error: 'loginUrl' };
    if (!username || username.length > 200) return { error: 'username' };
    if (!/^[\w.]{0,100}$/.test(tokenField)) return { error: 'tokenField' };
    Object.assign(values, { authType: 'login', loginUrl, username, tokenField });
  }
  // Empty secrets keep the saved ones; switching sign-in (or Basic auth) off forgets them.
  const password = String(input.password ?? '');
  if (password.length > 500) return { error: 'password' };
  if (values.authType === 'none') values.password = '';
  else if (password) values.password = password;
  // Extra headers: 'Name: value' lines; blank lines are dropped.
  const headerLines = String(input.headers ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (headerLines.length > 20 || !headerLines.every((l) => /^[A-Za-z0-9-]{1,64}\s*:\s*[^\r\n]{0,500}$/.test(l))) return { error: 'headers' };
  values.headers = headerLines.map((l) => l.replace(/\s*:\s*/, ': ')).join('\n');
  // Basic auth: the generated value, with or without the 'Basic ' prefix.
  const basicAuth = String(input.basicAuth ?? '').trim().replace(/^Basic\s+/i, '');
  if (basicAuth && (!/^[A-Za-z0-9+/=_-]+$/.test(basicAuth) || basicAuth.length > 1000)) return { error: 'basicAuth' };
  if (values.authType === 'none' || !input.useBasic) values.basicAuth = '';
  else if (basicAuth) values.basicAuth = basicAuth;
  values.useBasic = values.authType === 'login' && !!input.useBasic;
  return { values };
}

export async function saveDailyConfig(groupId, values) {
  const saved = await dailyConfig(groupId);
  if (values.authType === 'login' && !('password' in values) && !saved.hasPassword) {
    throw Object.assign(new Error('password'), { field: 'password' });
  }
  if (values.useBasic && !('basicAuth' in values) && !saved.hasBasicAuth) {
    throw Object.assign(new Error('basicAuth'), { field: 'basicAuth' });
  }
  const { useBasic: _u, ...rest } = values;
  // New settings may mean a new login: drop the saved token.
  const row = { ...rest, times: values.times.join(','), token: '' };
  await db.insert(reportSources)
    .values({ groupId, ...row })
    .onConflictDoUpdate({ target: reportSources.groupId, set: row })
    .run();
  await pushSchedule();
}

const enabledConfigs = () => db.select().from(reportSources).where(eq(reportSources.enabled, true)).all();

/**
 * Sends the helper the minutes to wake the bot at. Best effort: if the helper
 * can't be reached, the next save (or /dailyrun) tries again.
 */
export async function pushSchedule() {
  const times = [...new Set((await enabledConfigs()).flatMap((c) => parseTimes(c.times)))].sort();
  try {
    const bot = (await api.getMe()).username;
    const res = await fetch(`${SYNC_HELPER_URL}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SYNC_HELPER_SECRET}` },
      body: JSON.stringify({ times, bot }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return true;
  } catch (e) {
    console.error('pushSchedule failed:', e.message);
    return false;
  }
}

export const reportHistory = (groupId, limit = 30) => db.select().from(reportSnapshots)
  .where(eq(reportSnapshots.groupId, groupId)).orderBy(desc(reportSnapshots.day)).limit(limit).all();

/** One day's saved report ('YYYY-MM-DD'), or undefined. */
export const reportForDay = (groupId, day) => db.select().from(reportSnapshots)
  .where(and(eq(reportSnapshots.groupId, groupId), eq(reportSnapshots.day, day))).get();

/** Days ('YYYY-MM-DD') in [from, to] that have a successful saved report. */
export async function reportDays(groupId, from, to) {
  const rows = await db.select({ day: reportSnapshots.day }).from(reportSnapshots)
    .where(and(eq(reportSnapshots.groupId, groupId), gte(reportSnapshots.day, from), lte(reportSnapshots.day, to), eq(reportSnapshots.ok, true)))
    .all();
  return new Set(rows.map((r) => r.day));
}

/** The URL with {date} and {group} filled in. */
export const buildUrl = (url, day, group) => url
  .replaceAll('{date}', encodeURIComponent(day))
  .replaceAll('{group}', encodeURIComponent(String(group.tgId)));

/** A dotted path ('data.token') out of a parsed reply. */
const pick = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const TOKEN_FIELDS = ['token', 'access_token', 'accessToken', 'jwt', 'id_token', 'data.token', 'data.access_token', 'data.accessToken', 'data.jwt', 'result.token', 'result.access_token'];

/** Signs in (cfg.authType 'login') and returns the bearer token, or throws a short reason. */
/** True when a JWT's exp is past (or within a minute); tokens that aren't JWTs never count as expired. */
function tokenExpired(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    return typeof exp === 'number' && exp - 60 <= now();
  } catch {
    return false;
  }
}

/** The API's own reason from an error reply (message / error / error_description), short. */
function replyReason(text) {
  let reason = '';
  try {
    const j = JSON.parse(text);
    reason = [j.message, j.error_description, j.error, j.messageKey].find((v) => typeof v === 'string' && v) ?? '';
  } catch {
    reason = text;
  }
  reason = String(reason).replace(/\s+/g, ' ').trim().slice(0, 160);
  return reason ? ` — ${reason}` : '';
}

/** The config's extra headers as an object. */
const extraHeaders = (cfg) => Object.fromEntries(String(cfg.headers ?? '').split('\n').filter(Boolean)
  .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));

async function signIn(cfg, signal) {
  const headers = { ...extraHeaders(cfg), 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.basicAuth) headers.Authorization = `Basic ${cfg.basicAuth}`;
  const res = await fetch(cfg.loginUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}${replyReason(text)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Login reply is not JSON');
  }
  const paths = cfg.tokenField ? [cfg.tokenField] : TOKEN_FIELDS;
  for (const path of paths) {
    const token = pick(data, path);
    if (typeof token === 'string' && token) return token;
  }
  // Names only, never values, so the right token field can be set.
  const keys = (o, prefix = '') => Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && !prefix ? keys(v, `${k}.`) : [`${prefix}${k}`]));
  throw new Error(`Login OK but no token found. Reply fields: ${keys(data).slice(0, 15).join(', ') || '—'}`);
}

/**
 * GET requests signed in the way the group's source says: extra headers, and
 * for 'login' the saved token, logging in when there is none or it has
 * expired, and once more when a call with the saved token answers 401. Calls
 * may run in parallel; they share one login. Returns request(url) → Response,
 * with request.token() → the current token (logging in if needed).
 */
export function openSession(group, cfg, signal) {
  let token = cfg.authType === 'login' && cfg.token && !tokenExpired(cfg.token) ? cfg.token : null;
  let pending = null;
  const fresh = () => (pending ??= (async () => {
    token = await signIn(cfg, signal);
    await db.update(reportSources).set({ token }).where(eq(reportSources.groupId, group.id)).run();
  })().finally(() => { pending = null; }));
  const request = async (url) => {
    if (cfg.authType === 'login' && !token) await fresh();
    const used = token;
    const call = () => fetch(url, {
      headers: { ...extraHeaders(cfg), Accept: 'application/json, text/plain', ...(token && { Authorization: `Bearer ${token}` }) },
      signal,
    });
    let res = await call();
    if (res.status === 401 && cfg.authType === 'login') {
      if (token === used) await fresh(); // else another call already logged in again
      res = await call();
    }
    return res;
  };
  request.token = async () => {
    if (cfg.authType === 'login' && !token) await fresh();
    return token;
  };
  return request;
}

/**
 * Calls the group's URL now (signing in first if set), saves the result as today's report for `slot`
 * ('HH:MM'; default: this minute), replacing an earlier one for that slot, and,
 * if set, posts it in the group. Returns the saved row.
 */
export async function runDaily(group, cfg, slot = nowHHMM(), day = dayKey(today())) {
  const row = { groupId: group.id, day, slot, ranAt: now(), ok: false, httpStatus: 0, body: '', error: null, body2: '', error2: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const failure = (e) => (e?.name === 'AbortError' ? `No answer in ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 300));

  const request = openSession(group, cfg, controller.signal);
  const get = async (rawUrl) => {
    const res = await request(buildUrl(rawUrl, day, group));
    const text = await res.text();
    const body = (res.ok && compactLottery(text)) || text.slice(0, MAX_BODY);
    return { res, body, error: res.ok ? null : `HTTP ${res.status}${replyReason(body)}` };
  };

  try {
    const first = await get(cfg.url);
    Object.assign(row, { httpStatus: first.res.status, ok: first.res.ok, body: first.body, error: first.error });
    if (row.ok && cfg.url2) {
      try {
        const second = await get(cfg.url2);
        Object.assign(row, { body2: second.body, error2: second.error });
      } catch (e) {
        row.error2 = failure(e);
      }
    }
  } catch (e) {
    row.error = failure(e);
  } finally {
    clearTimeout(timer);
  }
  // One row per day: replace it, but a failed run keeps the last good report
  // (only noting the time it ran for, so that time isn't retried every minute).
  const saved = !row.ok && (await reportForDay(group.id, day));
  if (saved?.ok) {
    await db.update(reportSnapshots).set({ slot }).where(and(eq(reportSnapshots.groupId, group.id), eq(reportSnapshots.day, day))).run();
  } else {
    const { groupId: _g, day: _d, ...set } = row;
    await db.insert(reportSnapshots).values(row)
      .onConflictDoUpdate({ target: [reportSnapshots.groupId, reportSnapshots.day], set })
      .run();
  }
  if (row.ok && cfg.postToGroup) {
    const prev = await reportForDay(group.id, dayKey(addDays(parseDayKey(day), -1)));
    await api.sendMessage({ chat_id: group.tgId, text: formatReport(group, row, prev), parse_mode: 'HTML' }).catch((e) => console.error('daily post failed', e));
  }
  return row;
}

/** Snapshots are kept KEEP_DAYS days. */
export const pruneSnapshots = () => db.delete(reportSnapshots)
  .where(lt(reportSnapshots.day, dayKey(addDays(today(), -KEEP_DAYS)))).run();

/**
 * /dailyrun: for every enabled group, its latest time that has passed today,
 * if that time has no report yet. Returns [{ group, row }].
 */
export async function runDue() {
  const day = dayKey(today());
  const hhmm = nowHHMM();
  const done = [];
  await pruneSnapshots();
  for (const cfg of await enabledConfigs()) {
    const slot = parseTimes(cfg.times).filter((t) => t <= hhmm).at(-1);
    if (!slot || !cfg.url) continue;
    // Already ran for this time (or later, e.g. a manual run) today.
    if (((await reportForDay(cfg.groupId, day))?.slot ?? '') >= slot) continue;
    const group = (await listGroups()).find((g) => g.id === cfg.groupId);
    if (!group) continue;
    done.push({ group, row: await runDaily(group, toConfig(cfg, true), slot) });
  }
  return done;
}

/** What groups see this feature called. */
export const REPORT_NAME = 'របាយការណ៍ឆ្នោត';

const riel = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/** Phnom Penh '08:30 AM' from drawAtPP ('2026-11-04 08:30:00') or drawAt (UTC ISO). */
function drawTime(item) {
  let h;
  let m;
  const pp = /\d{4}-\d\d-\d\d[ T](\d\d):(\d\d)/.exec(item.drawAtPP ?? '');
  if (pp) [h, m] = [Number(pp[1]), pp[2]];
  else {
    const t = Date.parse(item.drawAt ?? '');
    if (Number.isNaN(t)) return '—';
    const d = new Date(t + OFFSET * 1000);
    [h, m] = [d.getUTCHours(), pad2(d.getUTCMinutes())];
  }
  return `${pad2(h % 12 || 12)}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const SUMMARY_KEYS = ['commissionKhr', 'rewardAmountKhr', 'winLoseAmountKhr', 'winLoseAmountKhrUser', 'winLoseAmountKhrCompany', 'winLoseAmountUsd', 'userSendShare', 'companySendShare'];
const DRAW_KEYS = ['drawAtPP', 'drawAt', 'drawCode', 'betAmountKhr', 'commissionKhr', 'rewardAmountKhr', 'winLoseAmountKhr', 'winLoseAmountKhrUser', 'winLoseAmountKhrCompany'];

/**
 * A lottery daily report reply cut down to what formatLottery shows (~3 KB
 * instead of ~70 KB), as JSON text; null when the reply isn't that shape.
 */
export function compactLottery(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const body = data?.data;
  if (!body || !Array.isArray(body.items) || !('upperSummary' in body || 'underSummary' in body)) return null;
  return JSON.stringify({
    data: {
      items: body.items.map((it) => {
        const u = it?.upperLineSale;
        return u && {
          upperLineSale: {
            lotteryType: u.lotteryType,
            date: u.date,
            summary: pickKeys(u.summary, SUMMARY_KEYS),
            items: (u.items ?? []).map((d) => pickKeys(d, DRAW_KEYS)),
          },
        };
      }).filter(Boolean),
      upperSummary: {},
      underSummary: { totalAmounts: (body.underSummary?.totalAmounts ?? []).map((t) => pickKeys(t, ['lotteryType', 'totalAmountKhr', 'totalAmountUsd'])) },
    },
  });
}

/** The lottery report's lotteries with draws (upperLineSale), or null when the reply isn't that shape. */
function lotteriesOf(data) {
  const body = data?.data;
  if (!body || !Array.isArray(body.items) || !('upperSummary' in body || 'underSummary' in body)) return null;
  return body.items
    .map((it) => it?.upperLineSale)
    .filter((u) => u && u.summary && Array.isArray(u.items) && u.items.length);
}

/** Day totals in riel (and USD win/lose) over the lotteries. */
function lotteryTotals(lotteries) {
  const total = { bet: 0, reward: 0, wl: 0, user: 0, company: 0, usd: 0 };
  for (const { summary: s } of lotteries) {
    total.bet += Number(s.commissionKhr) || 0;
    total.reward += Number(s.rewardAmountKhr) || 0;
    total.wl += Number(s.winLoseAmountKhr) || 0;
    total.user += Number(s.winLoseAmountKhrUser) || 0;
    total.company += Number(s.winLoseAmountKhrCompany) || 0;
    total.usd += Number(s.winLoseAmountUsd) || 0;
  }
  return total;
}

/** A saved snapshot's win/lose total, for the day-before comparison; null if it has none. */
function snapshotWinLose(row) {
  if (!row?.ok) return null;
  try {
    const lotteries = lotteriesOf(JSON.parse(row.body));
    return lotteries?.length ? lotteryTotals(lotteries).wl : null;
  } catch {
    return null;
  }
}

/** '📈 ចំណេញ ៛158,500' (positive win/lose is the house's gain) or '📉 ខាត ៛6,600'. */
const profit = (wl) => (wl < 0 ? `📉 ខាត ៛${riel(-wl)}` : `📈 ចំណេញ ៛${riel(wl)}`);

/**
 * The lottery daily report (data.items[].upperLineSale with a summary and one
 * item per draw): the day's result on top (profit or loss, the user/company
 * split, bet and payout, and the change from the day before when `prevWl` is
 * known), then per lottery its result and, folded in an expandable quote, a
 * table of draws by Phnom Penh time; then the same for `data2` (the second
 * URL's reply) as 📤 សាង. Returns HTML, or null when the reply isn't that shape.
 */
function formatLottery(data, prevWl = null, data2 = null) {
  const lotteries = lotteriesOf(data);
  if (!lotteries) return null;
  if (!lotteries.length) {
    // The report exists but no draw has a result yet (e.g. early in the day).
    const amounts = (data.data.underSummary?.totalAmounts ?? []).filter((t) => Number(t.totalAmountKhr) || Number(t.totalAmountUsd));
    const lines = ['⏳ មិនទាន់មានលទ្ធផលឆ្នោតនៅឡើយ។'];
    if (amounts.length) {
      lines.push('', '<b>ចំនួនសរុប</b>');
      for (const t of amounts) lines.push(`🎰 ${escape(t.lotteryType)}: ៛${riel(t.totalAmountKhr)}${Number(t.totalAmountUsd) ? ` · $${Number(t.totalAmountUsd).toFixed(2)}` : ''}`);
      if (amounts.length > 1) lines.push(`<b>💰 សរុប: ៛${riel(amounts.reduce((n, t) => n + (Number(t.totalAmountKhr) || 0), 0))}</b>`);
    }
    return lines.join('\n');
  }

  const total = lotteryTotals(lotteries);
  const share = lotteries[0].summary;
  const out = [
    `<b>${profit(total.wl)}</b>`,
    `👤 ${escape(share.userSendShare ?? '')} ៛${riel(total.user)} · 🏢 ${escape(share.companySendShare ?? '')} ៛${riel(total.company)}`,
    `ចាក់ ៛${riel(total.bet)} · សង ៛${riel(total.reward)}`,
  ];
  if (total.usd) out.push(`💵 USD: $${total.usd.toFixed(2)}`);
  if (prevWl) {
    const pct = Math.round(((total.wl - prevWl) / Math.abs(prevWl)) * 100);
    out.push(`ធៀបម្សិលមិញ (៛${riel(prevWl)}): ${pct > 0 ? '↗️ +' : pct < 0 ? '↘️ ' : '→ '}${pct}%`);
  }

  out.push(...lotterySections(lotteries));

  // The second URL's reply (e.g. isSend=true), when it has draws: its own
  // result and lotteries, below the main ones.
  const second = lotteriesOf(data2);
  if (second?.length) {
    const t2 = lotteryTotals(second);
    const draws = second.reduce((n, u) => n + u.items.length, 0);
    out.push('', '━━━━━━━━━━━━', `<b>📤 សាង · ${profit(t2.wl)}</b>`, `ចាក់ ៛${riel(t2.bet)} · សង ៛${riel(t2.reward)} · ${draws} វេន`);
    out.push(...lotterySections(second));
  }
  return out.join('\n');
}

/** Per lottery: its result, then its draws by time in a table folded into an expandable quote. */
function lotterySections(lotteries) {
  const line = (a, b, c, d) => `${String(a).padEnd(8)}${String(b).padStart(9)}${String(c).padStart(9)}${String(d).padStart(9)}`;
  const rule = '─'.repeat(35);
  const out = [];
  for (const u of lotteries) {
    const s = u.summary;
    const rows = [...u.items].sort((a, b) => String(a.drawAtPP ?? a.drawAt).localeCompare(String(b.drawAtPP ?? b.drawAt)));
    const table = [
      line('Time', 'Bet', 'Reward', 'W/L'),
      rule,
      ...rows.map((it) => line(drawTime(it), riel(it.betAmountKhr ?? it.commissionKhr), riel(it.rewardAmountKhr), riel(it.winLoseAmountKhr))),
      rule,
      line('Total', riel(s.commissionKhr), riel(s.rewardAmountKhr), riel(s.winLoseAmountKhr)),
    ];
    out.push(
      '',
      `<b>🎰 ${escape(u.lotteryType)}</b> · ${rows.length} វេន · ${profit(Number(s.winLoseAmountKhr) || 0)}`,
      `<blockquote expandable><pre>${escape(table.join('\n'))}</pre></blockquote>`,
    );
  }
  return out;
}

/**
 * A saved report as a Telegram message (HTML): known report shapes laid out,
 * other JSON as key/value lines, anything else as text. `prev` is the day
 * before's snapshot, for the lottery report's comparison.
 */
export function formatReport(group, row, prev = null) {
  const [y, m, d] = row.day.split('-');
  const head = `<b>📥 ${REPORT_NAME} · ${d}/${m}/${y}</b>\n🏪 ${escape(group.name ?? group.tgId)}`;
  const foot = row.ranAt ? `\n\n<i>🕘 ទាញយកម៉ោង ${formatTime(row.ranAt)}</i>` : '';
  if (!row.ok) return `${head}\n\n⚠️ ${escape(row.error ?? 'Failed')}${foot}`;
  let data;
  try {
    data = JSON.parse(row.body);
  } catch {
    data = null;
  }
  let data2 = null;
  try {
    data2 = row.body2 ? JSON.parse(row.body2) : null;
  } catch {
    // not JSON: nothing to add
  }
  const lottery = formatLottery(data, snapshotWinLose(prev), data2);
  if (lottery) return `${head}\n\n${lottery.length > 3800 ? `${lottery.slice(0, 3800)}…` : lottery}${foot}`;
  let body;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const lines = Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`);
    body = lines.join('\n');
  } else if (data !== null) {
    body = JSON.stringify(data, null, 2);
  } else {
    body = row.body;
  }
  if (body.length > 3500) body = `${body.slice(0, 3500)}\n…`;
  return `${head}\n\n<pre>${escape(body || '—')}</pre>${foot}`;
}


const btn = (text, callback_data) => ({ text, callback_data });
const dm = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/**
 * The 📥 day picker: today, yesterday and five more days (a week per page,
 * `page` weeks back), • on days with a saved report. Buttons: DREP_<day>,
 * DRWK_<page>, BACK.
 */
export async function dayPicker(group, page = 0) {
  const now = today();
  const first = addDays(now, -7 * page);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(first, -i)));
  const saved = await reportDays(group.id, days.at(-1), days[0]);
  const label = (key, i) => {
    const mark = saved.has(key) ? ' •' : '';
    if (page === 0 && i === 0) return `ថ្ងៃនេះ${mark}`;
    if (page === 0 && i === 1) return `ម្សិលមិញ${mark}`;
    return `${dm(key)}${mark}`;
  };
  const buttons = days.map((key, i) => btn(label(key, i), `DREP_${key}`));
  const rows = [buttons.slice(0, 2), buttons.slice(2, 5), buttons.slice(5, 7)];
  rows.push([btn('◀ សប្ដាហ៍មុន', `DRWK_${page + 1}`), ...(page > 0 ? [btn('សប្ដាហ៍ក្រោយ ▶', `DRWK_${page - 1}`)] : [])]);
  rows.push([btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')]);
  return {
    text: `<b>📥 ${REPORT_NAME}</b>\nជ្រើសរើសថ្ងៃ (• មានរបាយការណ៍រួច):`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

/**
 * One day's report: the saved one, or (none saved yet, or `refresh`) fetched
 * now for that day and saved without posting. Buttons: previous/next day,
 * refresh (DREP!_<day>), other day (DREPORT), BACK.
 */
export async function dayReportScreen(group, day, { refresh = false } = {}) {
  const todayKey = dayKey(today());
  if (!parseDayKey(day) || day > todayKey) day = todayKey;
  let row = refresh ? null : await reportForDay(group.id, day);
  if (!row) {
    const cfg = await dailyConfig(group.id, { secret: true });
    row = await runDaily(group, { ...cfg, postToGroup: false }, nowHHMM(), day);
  }
  const d = parseDayKey(day);
  const prev = dayKey(addDays(d, -1));
  const next = dayKey(addDays(d, 1));
  const nav = [btn(`◀ ${dm(prev)}`, `DREP_${prev}`)];
  if (next <= todayKey) nav.push(btn(`${dm(next)} ▶`, `DREP_${next}`));
  return {
    text: formatReport(group, row, await reportForDay(group.id, prev)),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        nav,
        [btn('🔄 ទាញថ្មី', `DREP!_${day}`), btn('📅 ថ្ងៃផ្សេង', 'DREPORT')],
        [btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')],
      ],
    },
  };
}
