// Agent Excel report: each lottery agent's monthly workbook, built from the
// template a super admin sends with /settemplate (the lottery report tool's
// template.xlsx) and filled the way that tool's fill_day.py does it:
//   - day tab N, rows 4-11 (one per lottery): C/D/E sales 2D/3D/4D, G win/lose
//     (report/daily-report/all at agent level: the same numbers as fill_day.py's
//     total-report per lottery, in one call);
//   - Member Tbl_01 (B:G), one row per member with bets: date, username, 2D,
//     3D, 4D, win/lose (report/total-report/all);
//   - Member Tbl_03 (X:AE), សាងលេខ: date, username, 2D, 3D, reward 2D/3D,
//     win/lose (send/total-report/all);
//   - MainPage B1 month, D15/E15 agent username/nick, M_report the members.
// Agents come from a lottery login (lib/logins.js; a group's Excel uses the
// group's login), and their finished days are fetched once and kept in
// agent_daily_totals.

import { db } from 'sdk';
import { and, asc, eq, gte, lt, lte } from 'sdk/db';
import { agentDailyTotals, agents } from '../schema.js';
import { addDays, dayKey, now, parseDayKey, startOf, today } from './dates.js';
import { groupsOfLogin } from './daily.js';
import { listLogins, openSession } from './logins.js';
import { getSetting } from './store.js';
import { Book, getNum, hasValue, put, putFormulaIfEmpty, serial } from './xlsx.js';

/** Day-tab row → lotteryType in the API (MHSB = LEAP, MC = VN1, MT = VN2, TC = TN). */
const ROWS = { 4: 'LEAP', 5: 'VN1', 6: 'VN2', 7: 'TN', 8: 'KH', 9: 'SC', 10: 'TH', 11: 'KP' };
const ROW_OF = Object.fromEntries(Object.entries(ROWS).map(([row, type]) => [type, Number(row)]));
const DAILY_FIELDS = { C: 'betAmount2DKhr', D: 'betAmount3DKhr', E: 'betAmount4DKhr', G: 'winLoseAmountKhr' };
const T1 = { first: 4, last: 500, cols: { B: null, C: null, D: 'betAmount2DKhr', E: 'betAmount3DKhr', F: 'betAmount4DKhr', G: 'winLoseAmountKhr' } };
const T3 = { first: 4, last: 129, cols: { X: null, Y: null, AA: 'betAmount2DKhr', AB: 'betAmount3DKhr', AC: 'rewardAmount2DKhr', AD: 'rewardAmount3DKhr', AE: 'winLoseAmountKhr' } };
// Member fields kept per day: the Excel's (T1/T3) plus the totals the 💰 សរុប view shows.
const TOTAL_FIELDS = ['commissionKhr', 'rewardAmountKhr', 'winLoseAmountUsd'];
const MEMBER_FIELDS = [...new Set([...Object.values(T1.cols), ...Object.values(T3.cols), ...TOTAL_FIELDS].filter(Boolean))];
const KEEP_MONTHS = 3;
const TODAY_FRESH_S = 300; // today's saved row is reused this long
const FINAL_AFTER_S = 3600; // a day fetched this long after it ended is final
const RETRY_MS = [600, 1800]; // waits before retrying a 5xx / 429
const TEMPLATE_KEY = 'agent_template'; // the template's Telegram file_id
const TEMPLATE_NAME_KEY = 'agent_template_name';

export const templateFileId = () => getSetting(TEMPLATE_KEY);
export { TEMPLATE_KEY, TEMPLATE_NAME_KEY };

const num = (v) => Number(v) || 0;
const totalBet = (r) => [1, 2, 3, 4, 5].reduce((n, d) => n + num(r[`betAmount${d}DKhr`]) + num(r[`betAmount${d}DUsd`]), 0);


/** The logged-in user's code from a JWT (userCode / user_code), or null. */
function tokenUserCode(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    return p.userCode ?? p.user_code ?? null;
  } catch {
    return null;
  }
}

/** A signed-in JSON getter for a login (getLogin with secret). */
function sessionFor(login) {
  if (!login?.baseUrl) throw new Error('No lottery login for this.');
  const base = login.baseUrl;
  const request = openSession(login);
  const json = async (path, params) => {
    const url = `${base}/${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await request(url);
      const body = await res.json().catch(() => null);
      if (res.ok && body) return body;
      const busy = res.status >= 500 || res.status === 429;
      if (!busy || attempt >= RETRY_MS.length) throw new Error(`${path}: HTTP ${res.status}${body?.message ? ` — ${body.message}` : ''}`);
      await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
    }
  };
  return { json, token: request.token };
}

/** The first array of user-like rows (username + userCode) anywhere in a reply. */
function userRows(o) {
  if (Array.isArray(o)) {
    if (o.length && o.every((x) => x && typeof x === 'object' && (x.username ?? x.userName) && (x.userCode ?? x.code))) return o;
    for (const x of o) { const r = userRows(x); if (r) return r; }
  } else if (o && typeof o === 'object') {
    for (const v of Object.values(o)) { const r = userRows(v); if (r) return r; }
  }
  return null;
}

/** Everyone at `level` under userCode (paged list-user-levels): [{ username, userCode, nickname }]. */
async function listUsers(json, userCode, level) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= 40; page++) {
    const rows = userRows(await json('user/list-user-levels', { size: 50, page, userCode, filterByLevel: level })) ?? [];
    const fresh = rows.filter((r) => !seen.has(r.userCode ?? r.code));
    for (const r of fresh) {
      seen.add(r.userCode ?? r.code);
      out.push({ username: r.username ?? r.userName, userCode: r.userCode ?? r.code, nickname: r.nickname ?? '' });
    }
    if (!fresh.length || rows.length < 50) break;
  }
  return out;
}

// ---------------------------------------------------------------- agents of a login
export const loginAgents = (loginId) => db.select().from(agents)
  .where(eq(agents.loginId, loginId)).orderBy(asc(agents.username)).all();

export const getAgent = (id) => db.select().from(agents).where(eq(agents.id, id)).get();

/** Refreshes a login's agents and their members from the API. Returns the list. */
export async function syncAgents(login) {
  const { json, token } = sessionFor(login);
  const code = tokenUserCode(await token());
  if (!code) throw new Error('Can’t tell the login’s user code from its token.');
  const found = await listUsers(json, code, 'agent');
  const keep = new Set(found.map((a) => a.userCode));
  for (const a of await loginAgents(login.id)) {
    if (!keep.has(a.userCode)) await db.delete(agents).where(eq(agents.id, a.id)).run();
  }
  for (const a of found) {
    const members = JSON.stringify(await listUsers(json, a.userCode, 'member'));
    await db.insert(agents).values({ loginId: login.id, ...a, members })
      .onConflictDoUpdate({ target: [agents.loginId, agents.userCode], set: { username: a.username, nickname: a.nickname, members } })
      .run();
  }
  return loginAgents(login.id);
}

/** An agent's saved members; fetched (and saved) when there are none yet or `refresh`. */
async function membersOf(json, agent, { refresh = false } = {}) {
  let list = [];
  try {
    list = refresh ? [] : JSON.parse(agent.members || '[]');
  } catch {
    // broken JSON: fetch it again
  }
  if (!list.length) {
    list = await listUsers(json, agent.userCode, 'member');
    agent.members = JSON.stringify(list);
    await db.update(agents).set({ members: agent.members }).where(eq(agents.id, agent.id)).run();
  }
  return list;
}

/** Is a saved agent_daily_totals row still good? Today's: for TODAY_FRESH_S; past days: once fetched after they ended. */
function isCurrent(row, day, todayKey) {
  if (day === todayKey) return now() - row.fetchedAt < TODAY_FRESH_S;
  return row.fetchedAt === 0 || row.fetchedAt >= startOf(addDays(parseDayKey(day), 1)) + FINAL_AFTER_S;
}

// ---------------------------------------------------------------- days
/**
 * One day of an agent: { daily, m1, m3 }, the same numbers as fill_day.py's
 * plan_for in 3 calls instead of 8 + 2 per member:
 *   - daily: report/daily-report/all at agent level has every lottery's
 *     summary (2D/3D/4D sales, win/lose), equal to total-report per lottery;
 *   - m1 / m3: report/ and send/total-report/all for the member level return
 *     all members at once; kept: this agent's members with bets.
 */
async function fetchDay(json, agent, day) {
  let mine = new Set((await membersOf(json, agent)).map((m) => m.userCode));
  const totals = { filterByLevel: 'member', filterByReportType: 'TOTAL', startDate: day, endDate: day, filterByUsername: agent.username };
  const [report, m1, m3] = await Promise.all([
    json('report/daily-report/all', { filterByReportType: 'ONE', filterByDate: day, filterByLevel: 'agent', filterByUserCode: agent.userCode }),
    json('report/total-report/all', totals),
    json('send/total-report/all', totals),
  ]);
  const daily = dailyCells((report?.data?.items ?? []).map((it) => [it.lotteryType ?? it.upperLineSale?.lotteryType, it.upperLineSale?.summary]));
  // A member with bets who isn't in the saved list (a new one): refresh the list, then filter exactly.
  const looksOurs = (r) => r.username?.startsWith(agent.username) && r.userCode !== agent.userCode;
  if ([...settlements(m1), ...settlements(m3)].some((r) => !mine.has(r.userCode) && looksOurs(r) && totalBet(r) > 0)) {
    mine = new Set((await membersOf(json, agent, { refresh: true })).map((m) => m.userCode));
  }
  return { daily, m1: memberRows(m1, mine), m3: memberRows(m3, mine) };
}

const settlements = (reply) => reply?.data?.settlements ?? [];

/** A day tab's cells ({ C4: …, G5: … }) from [lotteryType, summary] pairs. */
function dailyCells(pairs) {
  const daily = {};
  for (const [type, s] of pairs) {
    const row = ROW_OF[type];
    if (!s || !row) continue;
    for (const [col, field] of Object.entries(DAILY_FIELDS)) if (num(s[field])) daily[`${col}${row}`] = num(s[field]);
  }
  return daily;
}

/** The kept fields of a total-report reply's rows for the members in `mine` (user codes) with bets, by username. */
const memberRows = (reply, mine) => settlements(reply)
  .filter((r) => mine.has(r.userCode) && totalBet(r) > 0)
  .sort((a, b) => a.username.localeCompare(b.username))
  .map((r) => Object.fromEntries([['username', r.username], ['userCode', r.userCode], ...MEMBER_FIELDS.map((f) => [f, num(r[f])])]));

/**
 * A day's totals for every agent under a login in three calls (the scheduled
 * run): the agent-level by-draw report (one row per agent and draw, by
 * username) for the day tab, and report/ and send/total-report/all at member
 * level with no agent filter, which list every member under the login; each
 * agent gets its own members' rows, saved as fetchDay would. `agentReport`:
 * the agent-level by-draw reply when the caller already has it (the run's
 * agent reports), so it isn't asked for twice. Returns { agents (count), error }.
 */
export async function collectLoginDay(login, day, { agentReport = null } = {}) {
  const { json } = sessionFor(login);
  let list = await loginAgents(login.id);
  if (!list.length) list = await syncAgents(login);
  const totals = { filterByLevel: 'member', filterByReportType: 'TOTAL', startDate: day, endDate: day };
  let replies;
  try {
    replies = await Promise.all([
      agentReport ?? json('report/daily-report/all', { filterByReportType: 'ONE', filterByDate: day, filterByLevel: 'agent' }),
      json('report/total-report/all', totals),
      json('send/total-report/all', totals),
    ]);
  } catch (e) {
    return { agents: list.length, error: e.message };
  }
  const [report, m1, m3] = replies;
  const known = () => new Set(list.flatMap((a) => parseList(a.members).map((m) => m.userCode)));
  if ([...settlements(m1), ...settlements(m3)].some((r) => !known().has(r.userCode) && totalBet(r) > 0)) list = await syncAgents(login);
  for (const agent of list) {
    const mine = new Set(parseList(agent.members).map((m) => m.userCode));
    // The agent's rows per lottery, added up like the agent-level summary.
    const daily = dailyCells((report?.data?.items ?? []).map((it) => {
      const u = it.upperLineSale;
      const rows = (u?.items ?? []).filter((r) => r.username === agent.username);
      return [it.lotteryType ?? u?.lotteryType, rows.length ? Object.fromEntries(Object.values(DAILY_FIELDS).map((f) => [f, rows.reduce((n, r) => n + num(r[f]), 0)])) : null];
    }));
    const row = { data: JSON.stringify({ daily, m1: memberRows(m1, mine), m3: memberRows(m3, mine) }), fetchedAt: now() };
    await db.insert(agentDailyTotals).values({ agentCode: agent.userCode, day, ...row })
      .onConflictDoUpdate({ target: [agentDailyTotals.agentCode, agentDailyTotals.day], set: row }).run();
  }
  return { agents: list.length, error: null };
}

function parseList(text) {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const monthDays = (month) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

/**
 * Makes sure an agent's `days` ('YYYY-MM-DD', up to today) are saved and
 * current (isCurrent; `refresh`: today again regardless), fetching the rest
 * until `budgetMs` runs out. Returns { days: Map(day → data), missing,
 * total, members, error } (missing > 0: run again; error: why the last day
 * failed).
 */
export async function collectDays(login, agent, wanted, { budgetMs = 12000, refresh = false } = {}) {
  const started = Date.now();
  const todayKey = dayKey(today());
  const days = [...new Set(wanted)].filter((d) => d <= todayKey).sort();
  const rows = days.length ? await db.select().from(agentDailyTotals)
    .where(and(eq(agentDailyTotals.agentCode, agent.userCode), gte(agentDailyTotals.day, days[0]), lte(agentDailyTotals.day, days.at(-1))))
    .all() : [];
  const saved = new Map();
  const stale = new Set(days);
  for (const r of rows) {
    if (!days.includes(r.day)) continue;
    saved.set(r.day, JSON.parse(r.data)); // a stale row still counts if it can't be fetched now
    if (isCurrent(r, r.day, todayKey) && !(refresh && r.day === todayKey)) stale.delete(r.day);
  }
  const { json } = sessionFor(login);
  let error = null;
  for (const day of [...stale]) {
    if (Date.now() - started > budgetMs) break;
    let data;
    try {
      data = await fetchDay(json, agent, day);
    } catch (e) {
      error = `${day}: ${e.message}`; // keep what was collected; the user can run it again
      break;
    }
    const row = { data: JSON.stringify(data), fetchedAt: now() };
    await db.insert(agentDailyTotals).values({ agentCode: agent.userCode, day, ...row })
      .onConflictDoUpdate({ target: [agentDailyTotals.agentCode, agentDailyTotals.day], set: row }).run();
    saved.set(day, data);
    stale.delete(day);
  }
  // Days of months older than KEEP_MONTHS go.
  const { y, m } = today();
  const cutoff = new Date(Date.UTC(y, m - 1 - KEEP_MONTHS, 1)).toISOString().slice(0, 10);
  await db.delete(agentDailyTotals).where(lt(agentDailyTotals.day, cutoff)).run();
  const missing = days.filter((d) => !saved.has(d)).length;
  return { days: saved, missing, total: days.length, members: await membersOf(json, agent), error };
}

/** collectDays for a month ('YYYY-MM') up to yesterday: the Excel (a day goes in once it's over). */
export const collectMonth = (login, agent, month) => {
  const yesterday = dayKey(addDays(today(), -1));
  return collectDays(login, agent, monthDays(month).filter((d) => d <= yesterday));
};

// ---------------------------------------------------------------- 💰 member totals
/** A login's agents with their members (fetched again), for the Mini App. */
export async function memberOptions(login) {
  const list = await syncAgents(login);
  const { json } = sessionFor(login);
  const out = [];
  for (const a of list) {
    out.push({ agentCode: a.userCode, agent: a.username, agentNick: a.nickname, members: await membersOf(json, a) });
  }
  return out;
}

/**
 * Every login for the Mini App (no secrets), with the agents and members saved
 * under it (no API call) and how many enabled groups follow it.
 */
export async function loginsOverview() {
  const out = [];
  for (const login of await listLogins()) {
    const people = (await loginAgents(login.id)).map((a) => {
      let members = [];
      try { members = JSON.parse(a.members || '[]'); } catch { /* none */ }
      return { agentCode: a.userCode, agent: a.username, agentNick: a.nickname, members };
    });
    out.push({ ...login, people, groups: (await groupsOfLogin(login.id)).length });
  }
  return out;
}

const ZERO = () => Object.fromEntries(MEMBER_FIELDS.map((f) => [f, 0]));
const addInto = (sum, row) => { for (const f of MEMBER_FIELDS) sum[f] += num(row?.[f]); return sum; };

/**
 * A subject's totals over `days` (who: daily.js subjectOf — everyone under the
 * login, one agent, or one member), from agent_daily_totals (shared with the
 * Excel; missing or stale days fetched, `refresh`: today again): the sum of
 * the matching members' rows, so everyone/an agent is all its members.
 * Returns { report, send, perDay: [{ day, report, send }], missing, error }.
 */
export async function subjectTotals(login, who, days, { refresh = false, budgetMs = 12000 } = {}) {
  let list = await loginAgents(login.id);
  if (!list.length || (who.agentCode && !list.some((a) => a.userCode === who.agentCode))) list = await syncAgents(login);
  const wanted = who.kind === 'all' ? list : list.filter((a) => a.userCode === who.agentCode);
  if (!wanted.length) throw new Error(who.kind === 'all' ? 'No agents under this login.' : 'This agent isn’t under the login any more.');
  // A member by user code (rows saved before codes were kept: by username).
  const match = who.kind === 'member' ? (x) => (x.userCode ? x.userCode === who.code : x.username === who.name) : () => true;
  const started = Date.now();
  const perDayMap = new Map();
  let missing = 0;
  let error = null;
  for (const agent of wanted) {
    const r = await collectDays(login, agent, days, { refresh, budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
    missing = Math.max(missing, r.missing);
    error ??= r.error;
    for (const [day, { m1, m3 }] of r.days) {
      const one = perDayMap.get(day) ?? { day, report: null, send: null };
      for (const [field, rows] of [['report', m1], ['send', m3]]) {
        for (const x of rows.filter(match)) one[field] = addInto(one[field] ?? ZERO(), x);
      }
      perDayMap.set(day, one);
    }
  }
  const report = ZERO();
  const send = ZERO();
  const perDay = [...perDayMap.values()].sort((x, y) => x.day.localeCompare(y.day));
  for (const one of perDay) {
    addInto(report, one.report);
    addInto(send, one.send);
  }
  return { report, send, perDay, missing, error };
}

/**
 * For /dailyrun: saves yesterday for every agent of the given logins (with
 * secret), so the current month's Excel is usually ready at once. Failures
 * are only logged (the Excel button fetches what's missing).
 */
export async function collectYesterday(logins) {
  const yesterday = dayKey(addDays(today(), -1));
  for (const login of logins) {
    for (const agent of await loginAgents(login.id)) {
      // collectDays skips it when it's already saved and final.
      const r = await collectDays(login, agent, [yesterday]).catch((e) => ({ error: e.message }));
      if (r.error) console.error(`agent day ${agent.username} ${yesterday} failed`, r.error);
    }
  }
}

// ---------------------------------------------------------------- workbook
/** The M_report dropdown entry standing for a member: same text, else the same trailing number. */
function selectValue(username, options) {
  if (options.includes(username)) return username;
  const k = /(\d+)$/.exec(username);
  const hit = options.filter((o) => k && /(\d+)$/.exec(o) && Number(/(\d+)$/.exec(o)[1]) === Number(k[1]));
  return hit.length === 1 ? hit[0] : null;
}

function appendRows(s, spec, day, members) {
  const cols = Object.keys(spec.cols);
  const dateCol = cols[0];
  const ds = serial(day);
  let next = null;
  for (let r = spec.first; r <= spec.last; r++) {
    if (hasValue(s, `${dateCol}${r}`)) {
      if (getNum(s, `${dateCol}${r}`) === ds) return s; // already has this date
    } else if (next === null) next = r;
  }
  if (next === null || next + members.length - 1 > spec.last) throw new Error(`Member table full (rows ${spec.first}-${spec.last})`);
  for (const m of members) {
    for (const [col, field] of Object.entries(spec.cols)) {
      if (field === null) s = put(s, `${col}${next}`, col === dateCol ? ds : m.username);
      else if (m[field]) s = put(s, `${col}${next}`, m[field]);
    }
    next++;
  }
  return s;
}

const NEEDED_SHEETS = ['MainPage', 'Member', 'M_report', ...Array.from({ length: 31 }, (_, i) => String(i + 1))];

/** Null when the bytes are a usable template, else what's wrong with it. */
export async function checkTemplate(bytes) {
  let bk;
  try {
    bk = await Book.open(bytes);
  } catch {
    return 'This isn’t an .xlsx file.';
  }
  const missing = NEEDED_SHEETS.filter((n) => !bk.has(n));
  return missing.length ? `Missing sheet(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` : null;
}

/** The filled workbook (bytes) for an agent's month from its saved days. */
export async function buildWorkbook(templateBytes, agent, month, days, members) {
  const bk = await Book.open(templateBytes);
  for (const name of ['MainPage', 'Member', 'M_report', '1']) {
    if (!bk.has(name)) throw new Error(`The template has no "${name}" sheet: send the lottery report template.xlsx with /settemplate.`);
  }
  let mp = bk.sheet('MainPage');
  mp = put(mp, 'B1', serial(`${month}-01`));
  mp = put(mp, 'D15', agent.username);
  mp = put(mp, 'E15', agent.nickname || null);
  for (let r = 4; r <= 34; r++) [mp] = putFormulaIfEmpty(mp, `BJ${r}`, `-BI${r}`);
  bk.setSheet('MainPage', mp);

  // M_report staff list (the Member tables' dropdown): the agent's members, up to 16.
  let mr = bk.sheet('M_report');
  const roster = [...members].sort((a, b) => a.username.localeCompare(b.username)).slice(0, 16);
  for (let i = 0; i < 16; i++) {
    mr = put(mr, `E${3 + i}`, roster[i]?.username ?? null);
    mr = put(mr, `C${3 + i}`, roster[i]?.nickname || null);
  }
  bk.setSheet('M_report', mr);
  const options = roster.map((m) => m.username);
  const listed = (rows) => rows.map((r) => ({ ...r, username: selectValue(r.username, options) ?? r.username }));

  let mem = bk.sheet('Member');
  for (const day of [...days.keys()].sort()) {
    const { daily, m1, m3 } = days.get(day);
    const tab = String(Number(day.slice(8)));
    let s = bk.sheet(tab);
    for (const [ref, v] of Object.entries(daily)) s = put(s, ref, v);
    bk.setSheet(tab, s);
    mem = appendRows(mem, T1, day, listed(m1));
    mem = appendRows(mem, T3, day, listed(m3));
  }
  bk.setSheet('Member', mem);
  return bk.save();
}

// ---------------------------------------------------------------- bot screens (private admin panel)
const btn = (text, callback_data) => ({ text, callback_data });
const KH_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const monthLabel = (month) => `${KH_MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** XL: the agents under the group's login (found through the API the first time); XLSYNC refreshes them. */
export async function agentListScreen(login, { refresh = false } = {}) {
  let list = await loginAgents(login.id);
  let note = '';
  if (refresh || !list.length) {
    try {
      list = await syncAgents(login);
      note = refresh ? '\n✅ បានទាញបញ្ជីថ្មី' : '';
    } catch (e) {
      note = `\n⚠️ ${e.message}`;
    }
  }
  const rows = list.map((a) => [btn(`👤 ${a.username}`, `XLA_${a.id}`)]);
  rows.push([btn('🔄 ទាញបញ្ជីថ្មី', 'XLSYNC'), btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')]);
  return {
    text: `<b>📊 Excel ភ្នាក់ងារ</b>\n${list.length ? 'ជ្រើសរើសភ្នាក់ងារ:' : 'មិនមានភ្នាក់ងារ។'}${note}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

/** XLA_<id>: this month and the two before. */
export function monthScreen(agent) {
  const { y, m } = today();
  const months = [0, 1, 2].map((i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return {
    text: `<b>📊 ${agent.username}</b>\nជ្រើសរើសខែ:`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        ...months.map((mo) => [btn(`📅 ${monthLabel(mo)}`, `XLM_${agent.id}_${mo}`)]),
        [btn('⬅️ ត្រឡប់ក្រោយ', 'XL')],
      ],
    },
  };
}

/**
 * XLM_<id>_<YYYY-MM>: collects the month's finished days and sends the
 * workbook to chatId (the tapper's private chat; isPrivate: tapped there). Returns the screen to show afterwards (progress when
 * days are still missing, so the user taps again).
 */
export async function sendAgentExcel(login, agent, month, chatId, api, InputFile, isPrivate = true) {
  const back = { inline_keyboard: [[btn('🔄 ម្ដងទៀត', `XLM_${agent.id}_${month}`)], [btn('⬅️ ត្រឡប់ក្រោយ', `XLA_${agent.id}`)]] };
  const fileId = await templateFileId();
  if (!fileId) return { text: '⚠️ មិនទាន់មាន template ទេ។ Super admin ផ្ញើ template.xlsx ជាមួយ caption /settemplate ក្នុង chat ជាមួយ bot។', reply_markup: back };
  const r = await collectMonth(login, agent, month);
  if (r.missing) {
    const why = r.error ? `\n⚠️ ${r.error.slice(0, 200)}` : '';
    return { text: `⏳ បានទាញ ${r.total - r.missing}/${r.total} ថ្ងៃ — ចុច «🔄 ម្ដងទៀត» ដើម្បីបន្ត។${why}`, reply_markup: back };
  }
  const bytes = await buildWorkbook(await api.getFileContent(fileId), agent, month, r.days, r.members);
  await api.sendDocument({
    chat_id: chatId,
    document: new InputFile(bytes, `${agent.username}-${month}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    caption: `📊 ${agent.username} · ${monthLabel(month)}${r.total ? ` · ទិន្នន័យដល់ថ្ងៃ ${[...r.days.keys()].sort().at(-1).split('-').reverse().join('/')}` : ' · មិនទាន់មានថ្ងៃចប់'}`,
  });
  return { text: `✅ បានផ្ញើ Excel ${agent.username} · ${monthLabel(month)}${isPrivate ? '' : ' ទៅ chat ផ្ទាល់របស់អ្នក'}`, reply_markup: back };
}
