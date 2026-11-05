// Lottery API logins (super admins manage them in the Mini App: ⚙️ → 🔑). Each
// has its API base, credentials, extra headers, whether to fetch 📤 សាង, and
// its own run times. Groups pick a login and one member under it (daily.js).
//
// The routes are fixed: POST <base>/auth/login with { username, password }
// (plus HTTP Basic auth and extra headers when set); everything else is a GET
// under <base> with 'Authorization: Bearer <token>'. The token is saved on the
// login and reused until its JWT exp passes or a call answers 401.

import { api, db, fetch } from 'sdk';
import { asc, eq } from 'sdk/db';
import { lotteryLogins } from '../schema.js';
import { SYNC_HELPER_SECRET, SYNC_HELPER_URL } from './config.js';
import { now, pad2 } from './dates.js';

const OFFSET = 7 * 3600; // Phnom Penh, UTC+7
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 24;
export const LOGIN_PATH = 'auth/login';
export const REPORT_PATH = 'report/daily-report/all';

/** 'HH:MM' now in Phnom Penh. */
export function nowHHMM() {
  const d = new Date((now() + OFFSET) * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const parseTimes = (s) => String(s ?? '').split(',').filter((t) => TIME.test(t));

/** The base ('https://…/api/v1.0.0') from what was typed: the base itself, or any URL under it. */
export function normalizeBase(text) {
  const t = String(text ?? '').trim();
  return (/^(https?:\/\/[^\s?#]+?\/api\/v[\d.]+)(?:[/?#]|$)/.exec(t)?.[1] ?? t).replace(/\/+$/, '');
}

/**
 * A stored row as a login. Without `secret` the password and token are left
 * out and only hasPassword says whether one is saved (for the Mini App).
 */
function toLogin(r, secret) {
  const login = {
    id: r.id,
    enabled: !!r.enabled,
    baseUrl: r.baseUrl ?? '',
    username: r.username ?? '',
    hasPassword: !!r.password,
    // The Basic value is a client id/secret, shown so it can be checked; the password never is.
    basicAuth: r.basicAuth ?? '',
    headers: r.headers ?? '',
    sendReport: r.sendReport !== false,
    times: parseTimes(r.times),
    ranDay: r.ranDay ?? '',
    ranSlot: r.ranSlot ?? '',
  };
  if (secret) Object.assign(login, { password: r.password ?? '', token: r.token ?? '' });
  return login;
}

export async function listLogins({ secret = false } = {}) {
  const rows = await db.select().from(lotteryLogins).orderBy(asc(lotteryLogins.id)).all();
  return rows.map((r) => toLogin(r, secret));
}

/** One login, or null. `secret`: with the password and token (only for calling the API). */
export async function getLogin(id, { secret = false } = {}) {
  const r = id ? await db.select().from(lotteryLogins).where(eq(lotteryLogins.id, Number(id))).get() : null;
  return r ? toLogin(r, secret) : null;
}

/** Checks a login from the Mini App: { values } or { error } naming the bad field. */
export function checkLogin(input) {
  const baseUrl = normalizeBase(input.baseUrl);
  if (!/^https?:\/\/\S+$/.test(baseUrl) || baseUrl.length > 500) return { error: 'baseUrl' };
  const username = String(input.username ?? '').trim();
  if (!username || username.length > 200) return { error: 'username' };
  const list = Array.isArray(input.times) ? input.times.map(String) : [];
  if (!list.length || list.length > MAX_TIMES || !list.every((t) => TIME.test(t))) return { error: 'times' };
  const values = { enabled: input.enabled !== false, baseUrl, username, sendReport: input.sendReport !== false, times: [...new Set(list)].sort().join(',') };
  // An empty password keeps the saved one.
  const password = String(input.password ?? '');
  if (password.length > 500) return { error: 'password' };
  if (password) values.password = password;
  const headerLines = String(input.headers ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (headerLines.length > 20 || !headerLines.every((l) => /^[A-Za-z0-9-]{1,64}\s*:\s*[^\r\n]{0,500}$/.test(l))) return { error: 'headers' };
  values.headers = headerLines.map((l) => l.replace(/\s*:\s*/, ': ')).join('\n');
  // Basic auth: the generated value, with or without the 'Basic ' prefix; empty = none.
  const basicAuth = String(input.basicAuth ?? '').trim().replace(/^Basic\s+/i, '');
  if (basicAuth && (!/^[A-Za-z0-9+/=_-]+$/.test(basicAuth) || basicAuth.length > 1000)) return { error: 'basicAuth' };
  values.basicAuth = basicAuth;
  return { values };
}

/** Saves a login (id: update; none: new). New settings may mean a new login, so the token is dropped. Returns its id. */
export async function saveLogin(id, values) {
  const saved = id ? await getLogin(id) : null;
  if (id && !saved) throw Object.assign(new Error('login'), { field: 'login' });
  if (!('password' in values) && !saved?.hasPassword) throw Object.assign(new Error('password'), { field: 'password' });
  const row = { ...values, token: '' };
  let loginId = saved?.id;
  if (saved) await db.update(lotteryLogins).set(row).where(eq(lotteryLogins.id, saved.id)).run();
  else [{ id: loginId }] = await db.insert(lotteryLogins).values(row).returning().run();
  await pushSchedule();
  return loginId;
}

export async function deleteLogin(id) {
  await db.delete(lotteryLogins).where(eq(lotteryLogins.id, Number(id))).run();
  await pushSchedule();
}

/** Notes the scheduled time a login last ran for. */
export const markRan = (id, ranDay, ranSlot) => db.update(lotteryLogins).set({ ranDay, ranSlot }).where(eq(lotteryLogins.id, id)).run();

/**
 * Sends the helper the minutes to wake the bot at: every enabled login's
 * times. Best effort: if the helper can't be reached, the next save (or
 * /dailyrun) tries again.
 */
export async function pushSchedule() {
  const times = [...new Set((await listLogins()).filter((l) => l.enabled).flatMap((l) => l.times))].sort();
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

// ---------------------------------------------------------------- signing in
/** A JWT's payload, or null when it isn't one. */
export function jwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

/** True when a JWT's exp is past (or within a minute); tokens that aren't JWTs never count as expired. */
function tokenExpired(token) {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === 'number' && exp - 60 <= now();
}

/** The API's own reason from an error reply (message / error / error_description), short. */
export function replyReason(text) {
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

/** The login's extra headers as an object. */
const extraHeaders = (login) => Object.fromEntries(String(login.headers ?? '').split('\n').filter(Boolean)
  .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));

/** A dotted path ('data.token') out of a parsed reply. */
const pick = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const TOKEN_FIELDS = ['token', 'access_token', 'accessToken', 'jwt', 'id_token', 'data.token', 'data.access_token', 'data.accessToken', 'data.jwt', 'result.token', 'result.access_token'];

/** Signs in and returns the bearer token, or throws a short reason. */
async function signIn(login, signal) {
  const headers = { ...extraHeaders(login), 'Content-Type': 'application/json', Accept: 'application/json' };
  if (login.basicAuth) headers.Authorization = `Basic ${login.basicAuth}`;
  const res = await fetch(`${login.baseUrl}/${LOGIN_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username: login.username, password: login.password }),
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
  for (const path of TOKEN_FIELDS) {
    const token = pick(data, path);
    if (typeof token === 'string' && token) return token;
  }
  // Names only, never values.
  const keys = (o, prefix = '') => Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && !prefix ? keys(v, `${k}.`) : [`${prefix}${k}`]));
  throw new Error(`Login OK but no token found. Reply fields: ${keys(data).slice(0, 15).join(', ') || '—'}`);
}

/**
 * GET requests for a login (`secret`: from getLogin(id, { secret: true })):
 * extra headers and the saved token, logging in when there is none or it has
 * expired, and once more when a call with the saved token answers 401. Calls
 * may run in parallel; they share one login. Returns request(url) → Response,
 * with request.token() → the current token (logging in if needed).
 */
export function openSession(login, signal) {
  let token = login.token && !tokenExpired(login.token) ? login.token : null;
  let pending = null;
  const fresh = () => (pending ??= (async () => {
    token = await signIn(login, signal);
    await db.update(lotteryLogins).set({ token }).where(eq(lotteryLogins.id, login.id)).run();
  })().finally(() => { pending = null; }));
  const request = async (url) => {
    if (!token) await fresh();
    const used = token;
    const call = () => fetch(url, {
      headers: { ...extraHeaders(login), Accept: 'application/json, text/plain', Authorization: `Bearer ${token}` },
      signal,
    });
    let res = await call();
    if (res.status === 401) {
      if (token === used) await fresh(); // else another call already logged in again
      res = await call();
    }
    return res;
  };
  request.token = async () => {
    if (!token) await fresh();
    return token;
  };
  return request;
}

/** Who the login is, from its token: { code, level (its role, e.g. 'master'), name }. */
export async function loginUser(request) {
  const p = jwtPayload((await request.token()) ?? '') ?? {};
  const role = String(p.userRole ?? '');
  return { code: String(p.userCode ?? ''), level: /^[a-z]+$/i.test(role) ? role.toLowerCase() : 'agent', name: String(p.username ?? p.user_name ?? '') };
}
