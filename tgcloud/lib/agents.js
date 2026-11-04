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
// Agents come from the group's report login (report_sources), and their
// finished days are fetched once and kept in agent_days.

import { db } from 'sdk';
import { and, asc, eq, gte, lt, lte } from 'sdk/db';
import { agentDays, lotteryAgents } from '../schema.js';
import { addDays, dayKey, today } from './dates.js';
import { dailyConfig, openSession } from './daily.js';
import { getSetting } from './store.js';
import { Book, getNum, hasValue, put, putFormulaIfEmpty, serial } from './xlsx.js';

/** Day-tab row → lotteryType in the API (MHSB = LEAP, MC = VN1, MT = VN2, TC = TN). */
const ROWS = { 4: 'LEAP', 5: 'VN1', 6: 'VN2', 7: 'TN', 8: 'KH', 9: 'SC', 10: 'TH', 11: 'KP' };
const ROW_OF = Object.fromEntries(Object.entries(ROWS).map(([row, type]) => [type, Number(row)]));
const DAILY_FIELDS = { C: 'betAmount2DKhr', D: 'betAmount3DKhr', E: 'betAmount4DKhr', G: 'winLoseAmountKhr' };
const T1 = { first: 4, last: 500, cols: { B: null, C: null, D: 'betAmount2DKhr', E: 'betAmount3DKhr', F: 'betAmount4DKhr', G: 'winLoseAmountKhr' } };
const T3 = { first: 4, last: 129, cols: { X: null, Y: null, AA: 'betAmount2DKhr', AB: 'betAmount3DKhr', AC: 'rewardAmount2DKhr', AD: 'rewardAmount3DKhr', AE: 'winLoseAmountKhr' } };
const MEMBER_FIELDS = [...new Set([...Object.values(T1.cols), ...Object.values(T3.cols)].filter(Boolean))];
const KEEP_MONTHS = 3;
const RETRY_MS = [600, 1800]; // waits before retrying a 5xx / 429
const TEMPLATE_KEY = 'agent_template'; // the template's Telegram file_id
const TEMPLATE_NAME_KEY = 'agent_template_name';

export const templateFileId = () => getSetting(TEMPLATE_KEY);
export { TEMPLATE_KEY, TEMPLATE_NAME_KEY };

const num = (v) => Number(v) || 0;
const totalBet = (r) => [1, 2, 3, 4, 5].reduce((n, d) => n + num(r[`betAmount${d}DKhr`]) + num(r[`betAmount${d}DUsd`]), 0);

/** The API's base ('…/api/v1.0.0') from the source's login URL. */
function apiBase(cfg) {
  const m = /^(https?:\/\/.+?\/api\/v[\d.]+)\//.exec(cfg.loginUrl || cfg.url);
  if (!m) throw new Error('Set the 📥 report login first (login URL …/api/v1.0.0/auth/login).');
  return m[1];
}

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

/** A signed-in JSON getter for a group, from its 📥 report source. */
async function sessionFor(group) {
  const cfg = await dailyConfig(group.id, { secret: true });
  if (cfg.authType !== 'login') throw new Error('Set the 📥 report login for this group first.');
  const base = apiBase(cfg);
  const request = openSession(group, cfg);
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

// ---------------------------------------------------------------- agents of a group
export const groupAgents = (groupId) => db.select().from(lotteryAgents)
  .where(eq(lotteryAgents.groupId, groupId)).orderBy(asc(lotteryAgents.username)).all();

export const getAgent = (id) => db.select().from(lotteryAgents).where(eq(lotteryAgents.id, id)).get();

/** Refreshes a group's agents from the API (those under its report login). Returns the list. */
export async function syncAgents(group) {
  const { json, token } = await sessionFor(group);
  const code = tokenUserCode(await token());
  if (!code) throw new Error('Can’t tell the login’s user code from its token.');
  const found = await listUsers(json, code, 'agent');
  const keep = new Set(found.map((a) => a.userCode));
  for (const a of await groupAgents(group.id)) {
    if (!keep.has(a.userCode)) await db.delete(lotteryAgents).where(eq(lotteryAgents.id, a.id)).run();
  }
  for (const a of found) {
    await db.insert(lotteryAgents).values({ groupId: group.id, ...a })
      .onConflictDoUpdate({ target: [lotteryAgents.groupId, lotteryAgents.userCode], set: { username: a.username, nickname: a.nickname } })
      .run();
  }
  return groupAgents(group.id);
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
async function fetchDay(json, agent, members, day) {
  const mine = new Set(members.map((m) => m.userCode));
  const totals = { filterByLevel: 'member', filterByReportType: 'TOTAL', startDate: day, endDate: day, filterByUsername: agent.username };
  const [report, m1, m3] = await Promise.all([
    json('report/daily-report/all', { filterByReportType: 'ONE', filterByDate: day, filterByLevel: 'agent', filterByUserCode: agent.userCode }),
    json('report/total-report/all', totals),
    json('send/total-report/all', totals),
  ]);
  const daily = {};
  for (const item of report?.data?.items ?? []) {
    const s = item.upperLineSale?.summary;
    const row = ROW_OF[item.lotteryType];
    if (!s || !row) continue;
    for (const [col, field] of Object.entries(DAILY_FIELDS)) if (num(s[field])) daily[`${col}${row}`] = num(s[field]);
  }
  const memberRows = (reply) => (reply?.data?.settlements ?? [])
    .filter((r) => mine.has(r.userCode) && totalBet(r) > 0)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((r) => Object.fromEntries([['username', r.username], ...MEMBER_FIELDS.map((f) => [f, num(r[f])])]));
  return { daily, m1: memberRows(m1), m3: memberRows(m3) };
}

const monthDays = (month) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

/**
 * Makes sure an agent's finished days of `month` ('YYYY-MM') are saved,
 * fetching missing ones until `budgetMs` runs out. Returns
 * { days, missing, total, members, error } (missing > 0: run again; error:
 * why the last day failed).
 */
export async function collectMonth(group, agent, month, budgetMs = 12000) {
  const started = Date.now();
  const lastDay = dayKey(addDays(today(), -1)); // only days that are over
  const days = monthDays(month).filter((d) => d <= lastDay);
  const saved = new Map((await db.select().from(agentDays)
    .where(and(eq(agentDays.agentCode, agent.userCode), gte(agentDays.day, days[0] ?? month), lte(agentDays.day, days.at(-1) ?? month)))
    .all()).map((r) => [r.day, JSON.parse(r.data)]));
  const { json } = await sessionFor(group);
  const members = await listUsers(json, agent.userCode, 'member');
  let missing = days.filter((d) => !saved.has(d));
  let error = null;
  for (const day of [...missing]) {
    if (Date.now() - started > budgetMs) break;
    let data;
    try {
      data = await fetchDay(json, agent, members, day);
    } catch (e) {
      error = `${day}: ${e.message}`; // keep what was collected; the user can run it again
      break;
    }
    await db.insert(agentDays).values({ agentCode: agent.userCode, day, data: JSON.stringify(data) })
      .onConflictDoUpdate({ target: [agentDays.agentCode, agentDays.day], set: { data: JSON.stringify(data) } }).run();
    saved.set(day, data);
    missing = missing.filter((d) => d !== day);
  }
  // Days of months older than KEEP_MONTHS go.
  const { y, m } = today();
  const cutoff = new Date(Date.UTC(y, m - 1 - KEEP_MONTHS, 1)).toISOString().slice(0, 10);
  await db.delete(agentDays).where(lt(agentDays.day, cutoff)).run();
  return { days: saved, missing: missing.length, total: days.length, members, error };
}

/**
 * For /dailyrun: saves yesterday for every agent of the given groups, so the
 * current month's Excel is usually ready at once. Failures are only logged
 * (the Excel button fetches what's missing).
 */
export async function collectYesterday(groups) {
  const yesterday = dayKey(addDays(today(), -1));
  for (const group of groups) {
    for (const agent of await groupAgents(group.id)) {
      const have = await db.select({ id: agentDays.id }).from(agentDays)
        .where(and(eq(agentDays.agentCode, agent.userCode), eq(agentDays.day, yesterday))).get();
      if (have) continue;
      try {
        const { json } = await sessionFor(group);
        const data = await fetchDay(json, agent, await listUsers(json, agent.userCode, 'member'), yesterday);
        await db.insert(agentDays).values({ agentCode: agent.userCode, day: yesterday, data: JSON.stringify(data) })
          .onConflictDoNothing().run();
      } catch (e) {
        console.error(`agent day ${agent.username} ${yesterday} failed`, e.message);
      }
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

/** XL: the group's agents (found through the API the first time); XLSYNC refreshes them. */
export async function agentListScreen(group, { refresh = false } = {}) {
  let agents = await groupAgents(group.id);
  let note = '';
  if (refresh || !agents.length) {
    try {
      agents = await syncAgents(group);
      note = refresh ? '\n✅ បានទាញបញ្ជីថ្មី' : '';
    } catch (e) {
      note = `\n⚠️ ${e.message}`;
    }
  }
  const rows = agents.map((a) => [btn(`👤 ${a.username}${a.nickname ? ` · ${a.nickname}` : ''}`, `XLA_${a.id}`)]);
  rows.push([btn('🔄 ទាញបញ្ជីថ្មី', 'XLSYNC'), btn('⬅️ ត្រឡប់ក្រោយ', 'BACK')]);
  return {
    text: `<b>📊 Excel ភ្នាក់ងារ</b>\n${agents.length ? 'ជ្រើសរើសភ្នាក់ងារ:' : 'មិនមានភ្នាក់ងារ។'}${note}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

/** XLA_<id>: this month and the two before. */
export function monthScreen(agent) {
  const { y, m } = today();
  const months = [0, 1, 2].map((i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return {
    text: `<b>📊 ${agent.username}</b>${agent.nickname ? ` · ${agent.nickname}` : ''}\nជ្រើសរើសខែ:`,
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
export async function sendAgentExcel(group, agent, month, chatId, api, InputFile, isPrivate = true) {
  const back = { inline_keyboard: [[btn('🔄 ម្ដងទៀត', `XLM_${agent.id}_${month}`)], [btn('⬅️ ត្រឡប់ក្រោយ', `XLA_${agent.id}`)]] };
  const fileId = await templateFileId();
  if (!fileId) return { text: '⚠️ មិនទាន់មាន template ទេ។ Super admin ផ្ញើ template.xlsx ជាមួយ caption /settemplate ក្នុង chat ជាមួយ bot។', reply_markup: back };
  const r = await collectMonth(group, agent, month);
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
