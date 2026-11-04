// Sets an admin's role in one group: 'view', 'manage' or null (none). Super admins only.

import { EndpointError } from 'sdk';
import { assignRole } from '../lib/admin.js';
import { requireSuper } from '../lib/endpoint.js';
import { getAdmin } from '../lib/roles.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const userId = Number(input.userId);
  const role = input.role ?? null;
  if (![null, 'view', 'manage'].includes(role)) throw new EndpointError('Role must be view, manage or none.', { code: 'BAD_ROLE' });
  const admin = Number.isSafeInteger(userId) ? await getAdmin(userId) : null;
  if (!admin) throw new EndpointError('No such admin.', { code: 'NOT_FOUND' });
  if (admin.isSuper) throw new EndpointError('Super admins already have every group.', { code: 'IS_SUPER' });
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  await assignRole(userId, group, role);
  return { userId, groupId: group.tgId, role };
}
