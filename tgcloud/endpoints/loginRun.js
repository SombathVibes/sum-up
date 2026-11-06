// Runs a lottery login now (super admins; managers: their own), as its schedule would: everyone's
// and every member's and agent's by-draw report for today, and today's
// totals. Returns what came back: everyone's and the followed members'
// reports, how many members and agents were saved, and any totals error.

import { subjectLabel } from '../lib/daily.js';
import { requireLogin } from '../lib/endpoint.js';
import { runLogin } from '../lib/schedule.js';

export default async function (input, ctx) {
  const { login } = await requireLogin(ctx, input.id);
  const { reports, members, agents, totalsError } = await runLogin(login);
  return {
    reports: reports.map((r) => ({ who: subjectLabel(r.who), ok: !!r.ok, httpStatus: r.httpStatus, error: r.error, error2: r.error2 })),
    members: { count: members.count, error: members.error },
    agents,
    totalsError,
  };
}
