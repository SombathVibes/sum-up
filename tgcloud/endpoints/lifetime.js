// Turns a group's lifetime access on or off (super admins), like /sync → Lifetime.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup, setLifetime } from '../lib/store.js';
import { logActivity } from '../lib/activity.js';

export default async function (input, ctx) {
  const user = await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  await setLifetime(group.id, !!input.on);
  await logActivity(user, 'group.lifetime', group.name ?? String(group.tgId), input.on ? 'ON' : 'OFF');
  return { groupId: group.tgId, lifetime: !!input.on };
}
