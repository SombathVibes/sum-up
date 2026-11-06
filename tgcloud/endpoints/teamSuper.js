// Makes an admin a super admin, or not. Super admins only; config super admins can't be changed.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { getAdmin, isConfigSuper, setSuper } from '../lib/roles.js';
import { logActivity } from '../lib/activity.js';

export default async function (input, ctx) {
  const me = await requireSuper(ctx);
  const userId = Number(input.userId);
  const admin = Number.isSafeInteger(userId) ? await getAdmin(userId) : null;
  if (!admin) throw new EndpointError('No such admin.', { code: 'NOT_FOUND' });
  if (isConfigSuper(userId)) throw new EndpointError('This super admin is set in config.js.', { code: 'CONFIG' });
  if (userId === me.id) throw new EndpointError('You can’t change your own super admin status.', { code: 'SELF' });
  await setSuper(userId, !!input.on);
  await logActivity(me, 'team.super', admin.name ?? admin.username ?? String(userId), input.on ? 'ON' : 'OFF');
  return { userId, isSuper: !!input.on };
}
