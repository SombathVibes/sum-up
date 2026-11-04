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
import { and, desc, eq } from 'sdk/db';
import { dailyConfigs, dailyReports } from '../schema.js';
import { SYNC_HELPER_SECRET, SYNC_HELPER_URL } from './config.js';
import { dayKey, now, pad2, today } from './dates.js';
import { listGroups } from './store.js';

const OFFSET = 7 * 3600; // Phnom Penh, UTC+7
const MAX_BODY = 100_000;
const TIMEOUT_MS = 20_000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 24;

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'HH:MM' now in Phnom Penh. */
export function nowHHMM() {
  const d = new Date((now() + OFFSET) * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const DEFAULTS = { enabled: false, url: '', times: '21:00', postToGroup: true, authType: 'none', loginUrl: '', username: '', password: '', tokenField: '' };

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
    times: parseTimes(r.times),
    postToGroup: !!r.postToGroup,
    authType: r.authType === 'login' ? 'login' : 'none',
    loginUrl: r.loginUrl ?? '',
    username: r.username ?? '',
    tokenField: r.tokenField ?? '',
    hasPassword: !!r.password,
  };
  if (secret) cfg.password = r.password ?? '';
  return cfg;
}

/** A group's config, or the defaults (off). groupId is groups.id. `secret`: include the password (only for running it). */
export async function dailyConfig(groupId, { secret = false } = {}) {
  const row = await db.select().from(dailyConfigs).where(eq(dailyConfigs.groupId, groupId)).get();
  return toConfig(row, secret);
}

/** Checks new values: { values } or { error } naming the bad field. */
export function checkDaily(input) {
  const enabled = !!input.enabled;
  const url = String(input.url ?? '').trim();
  const list = Array.isArray(input.times) ? input.times.map(String) : [];
  if (url && (!/^https?:\/\/\S+$/.test(url) || url.length > 1000)) return { error: 'url' };
  if (enabled && !url) return { error: 'url' };
  if (!list.length || list.length > MAX_TIMES || !list.every((t) => TIME.test(t))) return { error: 'times' };
  const times = [...new Set(list)].sort();
  const values = { enabled, url, times, postToGroup: input.postToGroup !== false, authType: 'none', loginUrl: '', username: '', tokenField: '' };
  if (input.authType === 'login') {
    const loginUrl = String(input.loginUrl ?? '').trim();
    const username = String(input.username ?? '').trim();
    const tokenField = String(input.tokenField ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(loginUrl) || loginUrl.length > 1000) return { error: 'loginUrl' };
    if (!username || username.length > 200) return { error: 'username' };
    if (!/^[\w.]{0,100}$/.test(tokenField)) return { error: 'tokenField' };
    Object.assign(values, { authType: 'login', loginUrl, username, tokenField });
  }
  // An empty password keeps the saved one; switching sign-in off forgets it.
  const password = String(input.password ?? '');
  if (password.length > 500) return { error: 'password' };
  if (values.authType === 'none') values.password = '';
  else if (password) values.password = password;
  return { values };
}

export async function saveDailyConfig(groupId, values) {
  if (values.authType === 'login' && !('password' in values) && !(await dailyConfig(groupId)).hasPassword) {
    throw Object.assign(new Error('password'), { field: 'password' });
  }
  const row = { ...values, times: values.times.join(','), updatedAt: now() };
  await db.insert(dailyConfigs)
    .values({ groupId, ...row })
    .onConflictDoUpdate({ target: dailyConfigs.groupId, set: row })
    .run();
  await pushSchedule();
}

const enabledConfigs = () => db.select().from(dailyConfigs).where(eq(dailyConfigs.enabled, true)).all();

/**
 * Sends the helper the minutes to wake the bot at. Best effort: if the helper
 * can't be reached, the next save (or /dailyrun) tries again.
 */
export async function pushSchedule() {
  const times = [...new Set((await enabledConfigs()).flatMap((c) => parseTimes(c.times)))].sort();
  const bot = (await api.getMe()).username;
  try {
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

export const latestReport = (groupId) => db.select().from(dailyReports)
  .where(eq(dailyReports.groupId, groupId)).orderBy(desc(dailyReports.ranAt)).limit(1).get();

export const reportHistory = (groupId, limit = 30) => db.select().from(dailyReports)
  .where(eq(dailyReports.groupId, groupId)).orderBy(desc(dailyReports.ranAt)).limit(limit).all();

const slotReport = (groupId, day, slot) => db.select().from(dailyReports)
  .where(and(eq(dailyReports.groupId, groupId), eq(dailyReports.day, day), eq(dailyReports.slot, slot))).get();

/** The URL with {date} and {group} filled in. */
export const buildUrl = (url, day, group) => url
  .replaceAll('{date}', encodeURIComponent(day))
  .replaceAll('{group}', encodeURIComponent(String(group.tgId)));

/** A dotted path ('data.token') out of a parsed reply. */
const pick = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const TOKEN_FIELDS = ['token', 'access_token', 'accessToken', 'jwt', 'id_token', 'data.token', 'data.access_token', 'data.accessToken', 'data.jwt', 'result.token', 'result.access_token'];

/** Signs in (cfg.authType 'login') and returns the bearer token, or throws a short reason. */
async function signIn(cfg, signal) {
  const res = await fetch(cfg.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
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
 * Calls the group's URL now (signing in first if set), saves the result as today's report for `slot`
 * ('HH:MM'; default: this minute), replacing an earlier one for that slot, and,
 * if set, posts it in the group. Returns the saved row.
 */
export async function runDaily(group, cfg, slot = nowHHMM()) {
  const day = dayKey(today());
  const row = { groupId: group.id, day, slot, ranAt: now(), ok: false, httpStatus: 0, body: '', error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json, text/plain' };
    if (cfg.authType === 'login') headers.Authorization = `Bearer ${await signIn(cfg, controller.signal)}`;
    const res = await fetch(buildUrl(cfg.url, day, group), { headers, signal: controller.signal });
    row.httpStatus = res.status;
    row.body = (await res.text()).slice(0, MAX_BODY);
    row.ok = res.ok;
    if (!res.ok) row.error = `HTTP ${res.status}`;
  } catch (e) {
    row.error = e?.name === 'AbortError' ? `No answer in ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  const { groupId: _g, day: _d, slot: _s, ...set } = row;
  await db.insert(dailyReports).values(row)
    .onConflictDoUpdate({ target: [dailyReports.groupId, dailyReports.day, dailyReports.slot], set })
    .run();
  if (row.ok && cfg.postToGroup) {
    await api.sendMessage({ chat_id: group.tgId, text: formatReport(group, row), parse_mode: 'HTML' }).catch((e) => console.error('daily post failed', e));
  }
  return row;
}

/**
 * /dailyrun: for every enabled group, its latest time that has passed today,
 * if that time has no report yet. Returns [{ group, row }].
 */
export async function runDue() {
  const day = dayKey(today());
  const hhmm = nowHHMM();
  const done = [];
  for (const cfg of await enabledConfigs()) {
    const slot = parseTimes(cfg.times).filter((t) => t <= hhmm).at(-1);
    if (!slot || !cfg.url) continue;
    if (await slotReport(cfg.groupId, day, slot)) continue;
    const group = (await listGroups()).find((g) => g.id === cfg.groupId);
    if (!group) continue;
    done.push({ group, row: await runDaily(group, toConfig(cfg, true), slot) });
  }
  return done;
}

/** A saved report as a Telegram message (HTML): JSON as key/value lines, anything else as text. */
export function formatReport(group, row) {
  const [y, m, d] = row.day.split('-');
  const head = `<b>📥 Daily report · ${d}/${m}/${y}${row.slot ? ` ${row.slot}` : ''}</b>\n🏪 ${escape(group.name ?? group.tgId)}`;
  if (!row.ok) return `${head}\n\n⚠️ ${escape(row.error ?? 'Failed')}`;
  let data;
  try {
    data = JSON.parse(row.body);
  } catch {
    data = null;
  }
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
  return `${head}\n\n<pre>${escape(body || '—')}</pre>`;
}

