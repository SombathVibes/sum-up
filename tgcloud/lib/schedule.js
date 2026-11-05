// Scheduled runs, per lottery login. Telegram Serverless has no timer, so the
// sync helper's cron (sync-helper/) sends /dailyrun to the bot as the helper's
// user account (a super admin) at each scheduled minute; pushSchedule()
// (lib/logins.js) tells the helper which minutes those are: every enabled
// login's times.
//
// /dailyrun runs, for every enabled login, its latest time that has passed
// today if it hasn't run for it yet, so a missed minute catches up on the next
// trigger (earlier missed times are skipped, not run in a burst). A run saves,
// with one sign-in, in five calls (seven with 📤 សាង) however many members:
//   - everyone's by-draw report (and 📤), at the login's level;
//   - every member's by-draw report (and 📤) from one member-level call,
//     split per member (daily.js fetchMemberReports);
//   - every agent's day totals, from the agent-level report and the
//     member-level total reports (agents.js collectLoginDay).
// Nothing is posted: groups open 📥 in /menu.

import { collectLoginDay, loginAgents, syncAgents } from './agents.js';
import { fetchMemberReports, fetchReport, groupsOfLogin, pruneSnapshots, subjectOf } from './daily.js';
import { dayKey, today } from './dates.js';
import { listLogins, markRan, nowHHMM, openSession } from './logins.js';

/** A login's members [{ userCode, username }] from its saved agents; `refresh`: the lists fetched again. */
async function membersOfLogin(login, { refresh = false } = {}) {
  let list = refresh ? [] : await loginAgents(login.id);
  if (!list.length) list = await syncAgents(login);
  return list.flatMap((a) => {
    try {
      return JSON.parse(a.members || '[]');
    } catch {
      return [];
    }
  });
}

/**
 * One run of a login (with secret) for `slot`: { reports, members, totalsError }.
 * reports: everyone's row, then the members groups follow (from the split);
 * members: { count, error } for the member-level report.
 */
export async function runLogin(login, slot = nowHHMM(), day = dayKey(today())) {
  const request = openSession(login);
  const reports = [await fetchReport(login, day, await subjectOf(login.id, ''), { slot, request })];
  let members;
  try {
    members = await fetchMemberReports(login, day, (o) => membersOfLogin(login, o), { slot, request });
  } catch (e) {
    members = { count: 0, error: e.message };
  }
  // The followed members' saved rows, for the run's summary.
  const followed = new Map();
  for (const g of await groupsOfLogin(login.id)) if (g.memberCode) followed.set(g.memberCode, g);
  for (const [code, g] of followed) {
    const who = await subjectOf(login.id, code);
    reports.push({
      who: who.key === code ? who : { key: code, kind: 'member', code, level: 'member', name: g.memberName || code, nick: '' },
      subject: code, ok: !members.error, error: members.error,
    });
  }
  let totalsError = null;
  try {
    totalsError = (await collectLoginDay(login, day)).error;
  } catch (e) {
    totalsError = e.message;
  }
  return { reports, members, totalsError };
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
