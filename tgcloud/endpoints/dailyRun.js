// Runs a group's Daily report now (super admins), with its saved URL, even if
// it's switched off, to test it. Saved under this minute's slot; posted if asked and set.

import { EndpointError } from 'sdk';
import { dailyConfig, runDaily } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const cfg = await dailyConfig(group.id, { secret: true });
  if (!cfg.url) throw new EndpointError('Save a URL first.', { code: 'NO_URL' });
  const row = await runDaily(group, { ...cfg, postToGroup: !!input.post && cfg.postToGroup });
  return { day: row.day, slot: row.slot, ranAt: row.ranAt, ok: row.ok, httpStatus: row.httpStatus, error: row.error, body: row.body.slice(0, 4000) };
}
