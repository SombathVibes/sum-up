// A group's Daily report settings and its recent reports (super admins).

import { EndpointError } from 'sdk';
import { dailyConfig, reportHistory } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const reports = await reportHistory(group.id);
  return {
    config: await dailyConfig(group.id),
    reports: reports.map((r) => ({ day: r.day, slot: r.slot, ranAt: r.ranAt, ok: !!r.ok, httpStatus: r.httpStatus, error: r.error, body: r.body.slice(0, 4000) })),
  };
}
