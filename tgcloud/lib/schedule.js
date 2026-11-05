// Scheduled runs, per lottery login. Telegram Serverless has no timer, so the
// sync helper's cron (sync-helper/) sends /dailyrun to the bot as the helper's
// user account (a super admin) at each scheduled minute; pushSchedule()
// (lib/logins.js) tells the helper which minutes those are: every enabled
// login's times.
//
// /dailyrun runs, for every enabled login, its latest time that has passed
// today if it hasn't run for it yet, so a missed minute catches up on the next
// trigger (earlier missed times are skipped, not run in a burst). A run saves,
// with one shared sign-in:
//   - everyone's by-draw report (and 📤 សាង), at the login's level;
//   - the by-draw report of each member a group follows;
//   - every agent's day totals for today (all its members, agent_daily_totals).
// Nothing is posted: groups open 📥 in /menu.

import { collectDays, loginAgents, syncAgents } from './agents.js';
import { fetchReport, groupsOfLogin, pruneSnapshots, subjectOf } from './daily.js';
import { dayKey, today } from './dates.js';
import { listLogins, markRan, nowHHMM, openSession } from './logins.js';

/** One run of a login (with secret) for `slot`: { reports: [rows], totalsError }. */
export async function runLogin(login, slot = nowHHMM(), day = dayKey(today())) {
  const request = openSession(login);
  const reports = [await fetchReport(login, day, await subjectOf(login.id, ''), { slot, request })];
  // Each followed member once, however many groups follow them.
  const followed = new Map();
  for (const g of await groupsOfLogin(login.id)) if (g.memberCode) followed.set(g.memberCode, g);
  for (const [code, g] of followed) {
    const who = await subjectOf(login.id, code);
    const member = who.key === code ? who : { key: code, kind: 'member', code, level: 'member', name: g.memberName || code, nick: '', agentCode: g.agentCode };
    reports.push(await fetchReport(login, day, member, { slot, request }));
  }
  let totalsError = null;
  try {
    let list = await loginAgents(login.id);
    if (!list.length) list = await syncAgents(login);
    for (const agent of list) {
      const r = await collectDays(login, agent, [day], { refresh: true, budgetMs: 30000 });
      totalsError ??= r.error;
    }
  } catch (e) {
    totalsError = e.message;
  }
  return { reports, totalsError };
}

/** /dailyrun: every enabled login whose latest passed time hasn't run yet today. Returns [{ login, reports, totalsError }]. */
export async function runDue() {
  const day = dayKey(today());
  const hhmm = nowHHMM();
  const done = [];
  await pruneSnapshots();
  for (const login of await listLogins({ secret: true })) {
    if (!login.enabled || !login.baseUrl) continue;
    const slot = login.times.filter((t) => t <= hhmm).at(-1);
    if (!slot || (login.ranDay === day && login.ranSlot >= slot)) continue;
    await markRan(login.id, day, slot);
    done.push({ login, ...(await runLogin(login, slot, day)) });
  }
  return done;
}
