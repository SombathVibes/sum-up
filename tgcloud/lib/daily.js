// 📥 Lottery report. Logins (lib/logins.js) hold the API, credentials and run
// times; a super admin switches the report on for a group and picks one member
// under a login. In the group, people see only that member: the by-draw report
// per day (draw_reports, per login, day and subject) and 💰 totals
// (lib/totals.js). In the private admin panel super admins may also look at
// everyone under the login or any agent or member (🔀).
//
// Scheduled runs are per login (lib/schedule.js): the sync helper's cron sends
// /dailyrun at the logins' times.

import { db } from 'sdk';
import { and, desc, eq, gte, lt, lte } from 'sdk/db';
import { agents, drawReports, groupLotterySettings } from '../schema.js';
import { addDays, dayKey, formatTime, now, pad2, parseDayKey, today } from './dates.js';
import { getLogin, loginUser, nowHHMM, openSession, REPORT_PATH, replyReason } from './logins.js';
import { col, Doc, time } from './rich.js';

export { nowHHMM };

const OFFSET = 7 * 3600; // Phnom Penh, UTC+7
const MAX_BODY = 300_000; // replies that aren't the lottery shape are kept cut
const KEEP_DAYS = 7; // older days are fetched again when picked
const TIMEOUT_MS = 20_000;

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- group settings
/** A group's settings: { enabled, loginId, memberCode, memberName, agentCode } (off when none). groupId is groups.id. */
export async function dailyConfig(groupId) {
  const r = await db.select().from(groupLotterySettings).where(eq(groupLotterySettings.groupId, groupId)).get();
  return {
    enabled: !!r?.enabled,
    loginId: r?.loginId ?? 0,
    memberCode: r?.memberCode ?? '',
    memberName: r?.memberName ?? '',
    agentCode: r?.agentCode ?? '',
  };
}

/** Checks a group's new settings: { values } or { error } naming the bad field. On needs a login and a member. */
export function checkDaily(input) {
  const enabled = !!input.enabled;
  const loginId = Number(input.loginId) || 0;
  const memberCode = String(input.memberCode ?? '').trim();
  const agentCode = String(input.agentCode ?? '').trim();
  if (!/^\d{0,20}$/.test(memberCode) || !/^\d{0,20}$/.test(agentCode) || (memberCode && (!agentCode || !loginId))) return { error: 'member' };
  if (enabled && !memberCode) return { error: 'member' };
  const memberName = memberCode ? String(input.memberName ?? '').trim().slice(0, 80) : '';
  return { values: { enabled, loginId: memberCode ? loginId : 0, memberCode, memberName, agentCode: memberCode ? agentCode : '' } };
}

export async function saveDailyConfig(groupId, values) {
  if (values.loginId && !(await getLogin(values.loginId))) throw Object.assign(new Error('login'), { field: 'member' });
  await db.insert(groupLotterySettings)
    .values({ groupId, ...values })
    .onConflictDoUpdate({ target: groupLotterySettings.groupId, set: values })
    .run();
}

/** Enabled groups following a login: [{ groupId, memberCode, memberName, agentCode }]. */
export const groupsOfLogin = (loginId) => db.select().from(groupLotterySettings)
  .where(and(eq(groupLotterySettings.loginId, loginId), eq(groupLotterySettings.enabled, true))).all();

/** A deleted login: groups that followed it are switched off. */
export const dropLoginFromGroups = (loginId) => db.update(groupLotterySettings)
  .set({ enabled: false, loginId: 0 }).where(eq(groupLotterySettings.loginId, loginId)).run();

// ---------------------------------------------------------------- saved reports
export const reportHistory = (loginId, limit = 30) => db.select().from(drawReports)
  .where(eq(drawReports.loginId, loginId)).orderBy(desc(drawReports.day)).limit(limit).all();

/** One day's saved report ('YYYY-MM-DD') for a subject ('' = everyone), or undefined. */
export const reportForDay = (loginId, day, subject = '') => db.select().from(drawReports)
  .where(and(eq(drawReports.loginId, loginId), eq(drawReports.day, day), eq(drawReports.subject, subject))).get();

/** Days ('YYYY-MM-DD') in [from, to] that have a successful saved report for a subject. */
export async function reportDays(loginId, from, to, subject = '') {
  const rows = await db.select({ day: drawReports.day }).from(drawReports)
    .where(and(eq(drawReports.loginId, loginId), eq(drawReports.subject, subject), gte(drawReports.day, from), lte(drawReports.day, to), eq(drawReports.ok, true)))
    .all();
  return new Set(rows.map((r) => r.day));
}

/** Snapshots are kept KEEP_DAYS days. */
export const pruneSnapshots = () => db.delete(drawReports)
  .where(lt(drawReports.day, dayKey(addDays(today(), -KEEP_DAYS)))).run();

// ---------------------------------------------------------------- subjects
// Whose report: everyone under the login (key ''), one of its agents, or one
// member (key: the user code).

const parseMembers = (text) => {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

/** A login's saved agents (lib/agents.js syncs them), with their members parsed. */
export async function savedAgents(loginId) {
  const rows = await db.select().from(agents).where(eq(agents.loginId, loginId)).all();
  return rows.map((a) => ({ ...a, memberList: parseMembers(a.members) })).sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * A subject key as { key, kind: 'all'|'agent'|'member', code, level, name,
 * nick, agentCode }, checked against the login's saved agents and members; an
 * unknown code is everyone. For everyone, code/level/name come from the login
 * once signed in (fetchReport).
 */
export async function subjectOf(loginId, key) {
  if (key) {
    for (const a of await savedAgents(loginId)) {
      if (a.userCode === key) return { key, kind: 'agent', code: key, level: 'agent', name: a.username, nick: a.nickname, agentCode: key };
      const m = a.memberList.find((x) => x.userCode === key);
      if (m) return { key, kind: 'member', code: key, level: 'member', name: m.username, nick: m.nickname ?? '', agentCode: a.userCode };
    }
  }
  return { key: '', kind: 'all', code: '', level: '', name: '', nick: '', agentCode: '' };
}

/** A group's member as a subject (never everyone, even before the member list is saved). */
export async function groupSubject(cfg) {
  const s = await subjectOf(cfg.loginId, cfg.memberCode);
  if (s.key === cfg.memberCode) return s;
  return { key: cfg.memberCode, kind: 'member', code: cfg.memberCode, level: 'member', name: cfg.memberName || cfg.memberCode, nick: '', agentCode: cfg.agentCode };
}

/** '👥 ទាំងអស់ (login)' / '🧑‍💼 agent · nick' / '👤 member · nick'. */
export function subjectLabel(subject) {
  if (subject.kind === 'all') return `👥 ទាំងអស់${subject.name ? ` (${subject.name})` : ''}`;
  return `${subject.kind === 'agent' ? '🧑‍💼' : '👤'} ${subject.name}${subject.nick ? ` · ${subject.nick}` : ''}`;
}

/** A subject key in button data: the code, or 'a' for everyone. */
export const subjectToken = (key) => key || 'a';
/** Back from button data: 'a' → '', digits → the code, anything else → undefined (the group's member). */
export const tokenSubject = (tok) => (tok === 'a' ? '' : /^\d{1,20}$/.test(tok ?? '') ? tok : undefined);

// ---------------------------------------------------------------- fetching
/**
 * The by-draw report URL for a day and subject (its user code and level: a
 * member, an agent, or the login itself for everyone); `send`: the 📤 សាង side.
 */
export function reportUrl(login, day, subject, send = false) {
  const q = new URLSearchParams({ filterByUserCode: subject.code ?? '', filterByReportType: 'ONE', filterByDate: day, filterByLevel: subject.level || 'agent' });
  if (send) q.set('isSend', 'true');
  return `${login.baseUrl}/${REPORT_PATH}?${q}`;
}

/**
 * Fetches a subject's by-draw report for a day with a login (getLogin with
 * secret; `request`: a session to share, else one is opened), and 📤 សាង when
 * the login has it on, and saves it under `slot` ('HH:MM'; default: this
 * minute). A failed fetch keeps the last good report. Returns the row, with
 * `who` (the subject, filled in from the login for everyone).
 */
export async function fetchReport(login, day, who, { slot = nowHHMM(), request } = {}) {
  const row = { loginId: login.id, day, subject: who.key, slot, ranAt: now(), ok: false, httpStatus: 0, body: '', error: null, body2: '', error2: null };
  const controller = request ? null : new AbortController();
  const timer = controller && setTimeout(() => controller.abort(), TIMEOUT_MS);
  request ??= openSession(login, controller.signal);
  const get = async (send) => {
    const res = await request(reportUrl(login, day, who, send));
    const text = await res.text();
    const body = (res.ok && compactLottery(text)) || text.slice(0, MAX_BODY);
    return { res, body, error: res.ok ? null : `HTTP ${res.status}${replyReason(body)}` };
  };
  try {
    if (who.kind === 'all' && !who.code) who = { ...who, ...(await loginUser(request)) };
    const first = await get(false);
    Object.assign(row, { httpStatus: first.res.status, ok: first.res.ok, body: first.body, error: first.error });
    if (row.ok && login.sendReport) {
      try {
        const second = await get(true);
        Object.assign(row, { body2: second.body, error2: second.error });
      } catch (e) {
        row.error2 = failure(e);
      }
    }
  } catch (e) {
    row.error = failure(e);
  } finally {
    if (timer) clearTimeout(timer);
  }
  await saveReport(row);
  return Object.assign(row, { who });
}

const failure = (e) => (e?.name === 'AbortError' ? `No answer in ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 300));

/**
 * Saves a fetched report: one row per login, day and subject, replaced; but a
 * failed fetch keeps the last good report (only noting the time it ran for).
 */
async function saveReport(row) {
  const saved = !row.ok && (await reportForDay(row.loginId, row.day, row.subject));
  if (saved?.ok) {
    await db.update(drawReports).set({ slot: row.slot }).where(eq(drawReports.id, saved.id)).run();
  } else {
    const { loginId: _l, day: _d, subject: _s, ...set } = row;
    await db.insert(drawReports).values(row)
      .onConflictDoUpdate({ target: [drawReports.loginId, drawReports.day, drawReports.subject], set })
      .run();
  }
}

/**
 * Every member's (or agent's: `level`) by-draw report for a day, in one call
 * (two with 📤 សាង): the report at that level under the login lists one row
 * per user and draw, named by username (lottery-services
 * AllDailyReportServiceV2), which is split here into one saved report per
 * user, in the shape a one-user call gives (memberBody). `people()`: the
 * login's users at that level [{ userCode, username }]; called again with
 * { refresh: true } when the reply has one with bets it doesn't know.
 * Returns { count (users saved), error, data (the first reply, parsed, or null) }.
 */
export async function fetchLevelReports(login, day, level, people, { slot = nowHHMM(), request } = {}) {
  request ??= openSession(login);
  const get = async (send) => {
    const q = new URLSearchParams({ filterByReportType: 'ONE', filterByDate: day, filterByLevel: level });
    if (send) q.set('isSend', 'true');
    try {
      const res = await request(`${login.baseUrl}/${REPORT_PATH}?${q}`);
      const text = await res.text();
      if (!res.ok) return { status: res.status, error: `HTTP ${res.status}${replyReason(text.slice(0, MAX_BODY))}` };
      const data = JSON.parse(text);
      return Array.isArray(data?.data?.items) ? { status: res.status, data } : { status: res.status, error: 'Reply is not a lottery report' };
    } catch (e) {
      return { status: 0, error: failure(e) };
    }
  };
  const first = await get(false);
  const second = !first.error && login.sendReport ? await get(true) : null;
  let list = await people();
  const names = new Set(list.map((m) => m.username));
  const betting = (first.data?.data?.items ?? []).flatMap((it) => it?.upperLineSale?.items ?? []).map((r) => r.username);
  if (betting.some((u) => u && !names.has(u))) list = await people({ refresh: true });
  for (const m of list) {
    await saveReport({
      loginId: login.id, day, subject: m.userCode, slot, ranAt: now(),
      ok: !first.error, httpStatus: first.status, body: first.data ? memberBody(first.data, m.username) : '', error: first.error ?? null,
      body2: second?.data ? memberBody(second.data, m.username) : '', error2: second?.error ?? null,
    });
  }
  return { count: list.length, error: first.error ?? null, data: first.data ?? null };
}

/** fetchLevelReports for every member under the login. */
export const fetchMemberReports = (login, day, members, opts) => fetchLevelReports(login, day, 'member', members, opts);

/**
 * One user's part of a member- or agent-level report reply, as the compact
 * JSON text a one-user call gives (compactLottery): per lottery, that user's draw
 * rows, and a summary that adds them up (checked against one-member replies:
 * the same draws and the same totals).
 */
export function memberBody(data, username) {
  const items = [];
  const totalAmounts = [];
  const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  for (const it of data?.data?.items ?? []) {
    const u = it?.upperLineSale;
    const mine = (u?.items ?? []).filter((r) => r.username === username);
    if (!mine.length) continue;
    // Amounts add up; the user/company share is the member's, on every row.
    const summary = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, k.endsWith('Share') ? mine[0][k] : sum(mine, k)]));
    items.push({ upperLineSale: { lotteryType: u.lotteryType, date: u.date, summary, items: mine.map((d) => pickKeys(d, DRAW_KEYS)) } });
    totalAmounts.push({ lotteryType: u.lotteryType, totalAmountKhr: sum(mine, 'betAmountKhr'), totalAmountUsd: sum(mine, 'betAmountUsd') });
  }
  return JSON.stringify({ data: { items, upperSummary: {}, underSummary: { totalAmounts } } });
}

/** What groups see this feature called. */
export const REPORT_NAME = 'របាយការណ៍ឆ្នោត';

const riel = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/**
 * Phnom Penh 24-hour '16:30' from drawAtPP ('2026-11-04 16:30:00') or drawAt
 * (UTC ISO): short, so a phone's table keeps room for amounts in millions.
 */
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
  return `${pad2(h)}:${m}`;
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

/**
 * A saved report's day totals in riel ({ bet, reward, wl, user, company, usd }),
 * or null when it has none: today's live numbers, before the total reports
 * fill the day. `send`: the 📤 សាង side (body2) instead.
 */
export function snapshotTotals(row, { send = false } = {}) {
  if (!row?.ok) return null;
  try {
    const lotteries = lotteriesOf(JSON.parse(send ? row.body2 : row.body));
    return lotteries ? lotteryTotals(lotteries) : null;
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
  const doc = new Doc();
  if (!lotteries.length) {
    // The report exists but no draw has a result yet (e.g. early in the day).
    const amounts = (data.data.underSummary?.totalAmounts ?? []).filter((t) => Number(t.totalAmountKhr) || Number(t.totalAmountUsd));
    doc.line('⏳ មិនទាន់មានលទ្ធផលឆ្នោតនៅឡើយ។');
    if (amounts.length) {
      doc.line('').bold('ចំនួនសរុប');
      for (const t of amounts) doc.line(`🎰 ${escape(t.lotteryType)}: ៛${riel(t.totalAmountKhr)}${Number(t.totalAmountUsd) ? ` · $${Number(t.totalAmountUsd).toFixed(2)}` : ''}`);
      if (amounts.length > 1) doc.bold(`💰 សរុប: ៛${riel(amounts.reduce((n, t) => n + (Number(t.totalAmountKhr) || 0), 0))}`);
    }
    return doc;
  }

  const total = lotteryTotals(lotteries);
  const share = lotteries[0].summary;
  doc.bold(profit(total.wl))
    .line(`👤 ${escape(share.userSendShare ?? '')} ៛${riel(total.user)} · 🏢 ${escape(share.companySendShare ?? '')} ៛${riel(total.company)}`)
    .line(`ចាក់ ៛${riel(total.bet)} · សង ៛${riel(total.reward)}`);
  if (total.usd) doc.line(`💵 USD: $${total.usd.toFixed(2)}`);
  if (prevWl) {
    const pct = Math.round(((total.wl - prevWl) / Math.abs(prevWl)) * 100);
    doc.line(`ធៀបម្សិលមិញ (៛${riel(prevWl)}): ${pct > 0 ? '↗️ +' : pct < 0 ? '↘️ ' : '→ '}${pct}%`);
  }
  lotterySections(doc, lotteries);

  // The second URL's reply (e.g. isSend=true), when it has draws: its own
  // result and lotteries, below the main ones.
  const second = lotteriesOf(data2);
  if (second?.length) {
    const t2 = lotteryTotals(second);
    const draws = second.reduce((n, u) => n + u.items.length, 0);
    doc.rule().bold(`📤 សាង · ${profit(t2.wl)}`).line(`ចាក់ ៛${riel(t2.bet)} · សង ៛${riel(t2.reward)} · ${draws} វេន`);
    lotterySections(doc, second);
  }
  return doc;
}

// A lottery's draws: Phnom Penh time, bet, payout, win/lose.
const DRAW_COLS = [col('ម៉ោង', 'Time', 6), col('ចាក់', 'Bet', 10), col('សង', 'Reward', 10), col('ចំណេញ', 'W/L', 10)];

/** Per lottery: its result, then its draws in a folded table. */
function lotterySections(doc, lotteries) {
  for (const u of lotteries) {
    const s = u.summary;
    const rows = [...u.items].sort((a, b) => String(a.drawAtPP ?? a.drawAt).localeCompare(String(b.drawAtPP ?? b.drawAt)));
    doc.gap()
      .line(`<b>🎰 ${escape(u.lotteryType)}</b> · ${rows.length} វេន · ${profit(Number(s.winLoseAmountKhr) || 0)}`)
      .table(DRAW_COLS, rows.map((it) => [drawTime(it), riel(it.betAmountKhr ?? it.commissionKhr), riel(it.rewardAmountKhr), riel(it.winLoseAmountKhr)]), {
        total: ['Total', riel(s.commissionKhr), riel(s.rewardAmountKhr), riel(s.winLoseAmountKhr)],
        fold: `ប្រចាំវេន (${rows.length})`,
      });
  }
}

/**
 * A saved report as a screen's { text, rich } (lib/rich.js): the title, the
 * group (or login) and whose, the lottery report (formatLottery), and when it
 * was fetched, as a time each reader sees relative to now.
 */
export function formatReport(group, row, prev = null, who = null) {
  const [y, m, d] = row.day.split('-');
  const doc = new Doc()
    .title(`📋 របាយការណ៍ប្រចាំថ្ងៃ · ${d}/${m}/${y}`)
    .line(`${group.icon ?? '🏪'} ${escape(group.name ?? group.tgId)}${who ? ` · ${escape(subjectLabel(who))}` : ''}`)
    .line('');
  const foot = () => {
    if (row.ranAt) doc.line('').line(`<i>🕘 ទាញយក ${time(row.ranAt, formatTime(row.ranAt), 'r')}</i>`);
    return doc.out();
  };
  if (!row.ok) {
    doc.line(`⚠️ ${escape(row.error ?? 'Failed')}`);
    return foot();
  }
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
  if (lottery) {
    doc.add(lottery);
    return foot();
  }
  let body;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    body = Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join('\n');
  } else if (data !== null) {
    body = JSON.stringify(data, null, 2);
  } else {
    body = row.body;
  }
  if (body.length > 3500) body = `${body.slice(0, 3500)}\n…`;
  doc.line(`<pre>${escape(body || '—')}</pre>`);
  return foot();
}


// style (Bot API 9.4): 'primary' (blue), 'success' (green) or 'danger' (red).
const btn = (text, callback_data, style) => ({ text, callback_data, ...(style ? { style } : {}) });
const dm = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/**
 * DRTYPE[_<who>]: the report type for a subject (in a group, `who` is its
 * member; the panel's own 📥 picks whose first): 📋 the by-draw report per
 * day, or 💰 totals for a day, a week or a month, each opening on today
 * (DRNOW / TOTNOW), where ◀ ▶ and 📅 pick another day or period. ⬅️ goes back
 * to whose (`canSwitch`) or the menu.
 */
export function typePicker(who, { canSwitch = false } = {}) {
  const w = `_${subjectToken(who.key)}`;
  return {
    text: `<b>📥 ${REPORT_NAME}</b>\n${escape(subjectLabel(who))}\nជ្រើសរើសប្រភេទរបាយការណ៍:`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [btn('📋 របាយការណ៍ប្រចាំថ្ងៃ', `DRNOW${w}`, 'primary')],
        [btn('💰 របាយការណ៍សរុប', `TOTNOW${w}`, 'primary')],
        [btn('⬅️ ត្រឡប់ក្រោយ', canSwitch ? 'DRWHO' : 'BACK')],
      ],
    },
  };
}

/**
 * The 📥 day picker for a subject (who; in a group: its member): today,
 * yesterday and five more days (a week per page, `page` weeks back), • on
 * days with a saved report. Buttons: DREP_<day>_<who>, DRWK_<page>_<who>,
 * TOT_<who>, and DRWHO when `canSwitch` (super admins in the private panel).
 */
export async function dayPicker(cfg, who, page = 0, { canSwitch = false } = {}) {
  const tok = subjectToken(who.key);
  const now = today();
  const first = addDays(now, -7 * page);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(first, -i)));
  const saved = await reportDays(cfg.loginId, days.at(-1), days[0], who.key);
  const label = (key, i) => {
    const mark = saved.has(key) ? ' •' : '';
    if (page === 0 && i === 0) return `ថ្ងៃនេះ${mark}`;
    if (page === 0 && i === 1) return `ម្សិលមិញ${mark}`;
    return `${dm(key)}${mark}`;
  };
  const buttons = days.map((key, i) => btn(label(key, i), `DREP_${key}_${tok}`));
  const rows = [buttons.slice(0, 2), buttons.slice(2, 5), buttons.slice(5, 7)];
  rows.push([btn('◀ សប្ដាហ៍មុន', `DRWK_${page + 1}_${tok}`), ...(page > 0 ? [btn('សប្ដាហ៍ក្រោយ ▶', `DRWK_${page - 1}_${tok}`)] : [])]);
  if (canSwitch) rows.push([btn('🔀 ប្តូរអ្នក (សមាជិក / ភ្នាក់ងារ)', 'DRWHO')]);
  rows.push([btn('⬅️ ត្រឡប់ក្រោយ', `DRTYPE_${tok}`)]);
  return {
    text: `<b>📥 ${REPORT_NAME}</b>\n${escape(subjectLabel(who))}\nជ្រើសរើសថ្ងៃ (• មានរបាយការណ៍រួច):`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

const MAX_PICK = 60;

/**
 * Pick whose numbers to see (super admins, private panel): everyone, each
 * agent and each member under the login.
 * `target(tok)` is the button data for a choice; `back` the button data to go
 * back to. ⭐ marks the group's member.
 */
export async function subjectPicker(cfg, { target, back, title = `📥 ${REPORT_NAME}`, note = '' }) {
  const list = await savedAgents(cfg.loginId);
  const star = (key) => (key === cfg.memberCode ? ' ⭐' : '');
  const rows = [[btn('👥 ទាំងអស់', target('a'))]];
  let shown = 0;
  for (const a of list) {
    rows.push([btn(`🧑‍💼 ${a.username}${star(a.userCode)}`, target(a.userCode))]);
    const members = [...a.memberList].sort((x, y) => x.username.localeCompare(y.username));
    for (let i = 0; i < members.length && shown < MAX_PICK; i += 2) {
      rows.push(members.slice(i, i + 2).map((m) => btn(`👤 ${m.username}${star(m.userCode)}`, target(m.userCode))));
      shown += 2;
    }
  }
  rows.push([btn('🔄 ទាញបញ្ជីថ្មី', 'WHOSYNC'), btn('⬅️ ត្រឡប់ក្រោយ', back)]);
  const total = list.reduce((n, a) => n + a.memberList.length, 0);
  return {
    text: `<b>${title}</b>\nមើលរបស់អ្នកណា?${total > MAX_PICK ? `\n(បង្ហាញ ${MAX_PICK}/${total} នាក់)` : ''}${list.length ? '' : '\nមិនទាន់មានបញ្ជីភ្នាក់ងារ — ចុច «🔄 ទាញបញ្ជីថ្មី»។'}${note}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

/**
 * One day's report for a subject: the saved one, or (none saved yet, or
 * `refresh`) fetched now with the group's login and saved. Buttons:
 * previous/next day, refresh (DREP!_<day>_<who>), other day, 🔀 when
 * `canSwitch`, BACK.
 */
export async function dayReportScreen(group, cfg, who, day, { refresh = false, canSwitch = false } = {}) {
  const todayKey = dayKey(today());
  if (!parseDayKey(day) || day > todayKey) day = todayKey;
  const tok = subjectToken(who.key);
  let row = refresh ? null : await reportForDay(cfg.loginId, day, who.key);
  if (!row) {
    const login = await getLogin(cfg.loginId, { secret: true });
    if (!login) return { text: '⚠️ Login របស់ក្រុមនេះត្រូវបានលុប។', reply_markup: { inline_keyboard: [[btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')]] } };
    row = await fetchReport(login, day, who);
    who = row.who;
  }
  const d = parseDayKey(day);
  const prev = dayKey(addDays(d, -1));
  const next = dayKey(addDays(d, 1));
  const nav = [btn(`◀ ${dm(prev)}`, `DREP_${prev}_${tok}`)];
  if (next <= todayKey) nav.push(btn(`${dm(next)} ▶`, `DREP_${next}_${tok}`));
  return {
    ...formatReport(group, row, await reportForDay(cfg.loginId, prev, who.key), who),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        nav,
        [btn('🔄 ទាញថ្មី', `DREP!_${day}_${tok}`, 'success'), btn('📅 ថ្ងៃផ្សេង', `DRWK_0_${tok}`)],
        canSwitch ? [btn('🔀 ប្តូរអ្នក', `DRWHO_${day}`), btn('⬅️ ត្រឡប់ក្រោយ', `DRTYPE_${tok}`)] : [btn('⬅️ ត្រឡប់ក្រោយ', `DRTYPE_${tok}`)],
      ],
    },
  };
}
