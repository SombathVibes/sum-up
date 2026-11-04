// Daily report: per group (off by default, super admins switch it on), the bot
// calls the group's URL at its time, saves the response, and posts it in the group.
//
// Telegram Serverless has no timer, so the sync helper's cron (sync-helper/)
// sends /dailyrun to the bot as the helper's user account (a super admin) at
// each scheduled minute; pushSchedule() tells the helper which minutes those
// are. /dailyrun runs every enabled group whose time has passed and that has
// no report yet today, so a missed minute catches up on the next one.

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

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'HH:MM' now in Phnom Penh. */
export function nowHHMM() {
  const d = new Date((now() + OFFSET) * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const DEFAULTS = { enabled: false, url: '', time: '21:00', postToGroup: true };

/** A group's config, or the defaults (off) when it has none. groupId is groups.id. */
export async function dailyConfig(groupId) {
  const row = await db.select().from(dailyConfigs).where(eq(dailyConfigs.groupId, groupId)).get();
  return row ? { enabled: !!row.enabled, url: row.url, time: row.time, postToGroup: !!row.postToGroup } : { ...DEFAULTS };
}

/** Checks new values: { values } or { error } naming the bad field. */
export function checkDaily(input) {
  const enabled = !!input.enabled;
  const url = String(input.url ?? '').trim();
  const time = String(input.time ?? '');
  if (url && (!/^https?:\/\/\S+$/.test(url) || url.length > 1000)) return { error: 'url' };
  if (enabled && !url) return { error: 'url' };
  if (!TIME.test(time)) return { error: 'time' };
  return { values: { enabled, url, time, postToGroup: input.postToGroup !== false } };
}

export async function saveDailyConfig(groupId, values) {
  await db.insert(dailyConfigs)
    .values({ groupId, ...values, updatedAt: now() })
    .onConflictDoUpdate({ target: dailyConfigs.groupId, set: { ...values, updatedAt: now() } })
    .run();
  await pushSchedule();
}

const enabledConfigs = () => db.select().from(dailyConfigs).where(eq(dailyConfigs.enabled, true)).all();

/**
 * Sends the helper the minutes to wake the bot at. Best effort: if the helper
 * can't be reached, the next save (or /dailyrun) tries again.
 */
export async function pushSchedule() {
  const times = [...new Set((await enabledConfigs()).map((c) => c.time))].sort();
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
  .where(eq(dailyReports.groupId, groupId)).orderBy(desc(dailyReports.day)).limit(1).get();

export const reportHistory = (groupId, limit = 14) => db.select().from(dailyReports)
  .where(eq(dailyReports.groupId, groupId)).orderBy(desc(dailyReports.day)).limit(limit).all();

const todaysReport = (groupId, day) => db.select().from(dailyReports)
  .where(and(eq(dailyReports.groupId, groupId), eq(dailyReports.day, day))).get();

/** The URL with {date} and {group} filled in. */
export const buildUrl = (url, day, group) => url
  .replaceAll('{date}', encodeURIComponent(day))
  .replaceAll('{group}', encodeURIComponent(String(group.tgId)));

/**
 * Calls the group's URL now, saves the result as today's report (replacing an
 * earlier one) and, if set, posts it in the group. Returns the saved row.
 */
export async function runDaily(group, cfg) {
  const day = dayKey(today());
  const row = { groupId: group.id, day, ranAt: now(), ok: false, httpStatus: 0, body: '', error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(cfg.url, day, group), { headers: { Accept: 'application/json, text/plain' }, signal: controller.signal });
    row.httpStatus = res.status;
    row.body = (await res.text()).slice(0, MAX_BODY);
    row.ok = res.ok;
    if (!res.ok) row.error = `HTTP ${res.status}`;
  } catch (e) {
    row.error = e?.name === 'AbortError' ? `No answer in ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  const { groupId: _g, day: _d, ...set } = row;
  await db.insert(dailyReports).values(row)
    .onConflictDoUpdate({ target: [dailyReports.groupId, dailyReports.day], set })
    .run();
  if (row.ok && cfg.postToGroup) {
    await api.sendMessage({ chat_id: group.tgId, text: formatReport(group, row), parse_mode: 'HTML' }).catch((e) => console.error('daily post failed', e));
  }
  return row;
}

/**
 * /dailyrun: every enabled group whose time has passed today and that has no
 * report for today yet. Returns [{ group, row }].
 */
export async function runDue() {
  const day = dayKey(today());
  const hhmm = nowHHMM();
  const done = [];
  for (const cfg of await enabledConfigs()) {
    if (cfg.time > hhmm || !cfg.url) continue;
    if (await todaysReport(cfg.groupId, day)) continue;
    const group = (await listGroups()).find((g) => g.id === cfg.groupId);
    if (!group) continue;
    done.push({ group, row: await runDaily(group, { url: cfg.url, postToGroup: !!cfg.postToGroup }) });
  }
  return done;
}

/** A saved report as a Telegram message (HTML): JSON as key/value lines, anything else as text. */
export function formatReport(group, row) {
  const [y, m, d] = row.day.split('-');
  const head = `<b>📥 Daily report · ${d}/${m}/${y}</b>\n🏪 ${escape(group.name ?? group.tgId)}`;
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

