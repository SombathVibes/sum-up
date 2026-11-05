// A group's lottery report settings (super admins): on/off, and which login
// and member it follows; plus the logins with their saved agents and members
// to pick from (no API call).

import { EndpointError } from 'sdk';
import { loginsOverview } from '../lib/agents.js';
import { dailyConfig } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const logins = (await loginsOverview()).map((l) => ({ id: l.id, username: l.username, baseUrl: l.baseUrl, enabled: l.enabled, people: l.people }));
  return { config: await dailyConfig(group.id), logins };
}
