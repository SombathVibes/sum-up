// Runs a group's Daily report now (super admins), with its saved URL, even if
// it's switched off, to test it, for `subject` (a user code, '' = everyone;
// left out: the group's default). Saved under this minute's slot; posted if asked and set.

import { EndpointError } from 'sdk';
import { dailyConfig, runDaily } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const cfg = await dailyConfig(group.id, { secret: true });
  if (!cfg.baseUrl) throw new EndpointError('Save the API URL first.', { code: 'NO_URL' });
  const key = typeof input.subject === 'string' && /^\d{0,20}$/.test(input.subject) ? input.subject : cfg.memberCode;
  const row = await runDaily(group, { ...cfg, postToGroup: !!input.post && cfg.postToGroup }, undefined, undefined, key);
  return { day: row.day, subject: row.subject, slot: row.slot, ranAt: row.ranAt, ok: row.ok, httpStatus: row.httpStatus, error: row.error, body: row.body.slice(0, 4000), body2: row.body2.slice(0, 4000), error2: row.error2 };
}
