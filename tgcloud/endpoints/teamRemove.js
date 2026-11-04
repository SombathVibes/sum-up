// Removes an admin and all their group roles. Super admins only; config super admins stay.

import { EndpointError } from 'sdk';
import { deleteAdmin } from '../lib/admin.js';
import { requireSuper } from '../lib/endpoint.js';
import { getAdmin } from '../lib/roles.js';

export default async function (input, ctx) {
  const me = await requireSuper(ctx);
  const userId = Number(input.userId);
  if (!Number.isSafeInteger(userId) || !(await getAdmin(userId))) throw new EndpointError('No such admin.', { code: 'NOT_FOUND' });
  if (userId === me.id) throw new EndpointError('You can’t remove yourself.', { code: 'SELF' });
  if (!(await deleteAdmin(userId))) throw new EndpointError('This super admin is set in config.js.', { code: 'CONFIG' });
  return { userId };
}
