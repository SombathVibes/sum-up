// A group's Daily report settings, its recent reports, and the agents and
// members saved under its login (no API call: 🔄 in the Mini App uses
// dailyMembers to refresh them) (super admins).

import { EndpointError } from 'sdk';
import { dailyConfig, reportHistory, savedAgents } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const reports = await reportHistory(group.id);
  const list = await savedAgents(group.id);
  // Who a saved report is for, by name: '' is everyone.
  const names = new Map();
  for (const a of list) {
    names.set(a.userCode, `🧑‍💼 ${a.username}`);
    for (const m of a.memberList) names.set(m.userCode, `👤 ${m.username}`);
  }
  return {
    config: await dailyConfig(group.id),
    people: list.map((a) => ({ agentCode: a.userCode, agent: a.username, agentNick: a.nickname, members: a.memberList })),
    reports: reports.map((r) => ({
      day: r.day, subject: r.subject ?? '', who: r.subject ? names.get(r.subject) ?? `👤 ${r.subject}` : '👥 ទាំងអស់',
      slot: r.slot, ranAt: r.ranAt, ok: !!r.ok, httpStatus: r.httpStatus, error: r.error,
      body: r.body.slice(0, 4000), body2: (r.body2 ?? '').slice(0, 4000), error2: r.error2,
    })),
  };
}
