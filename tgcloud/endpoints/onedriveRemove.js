// ☁️ Disconnects a OneDrive account (whoever connected it, or a super admin);
// the groups using it switch off.

import { EndpointError } from 'sdk';
import { logActivity } from '../lib/activity.js';
import { caller } from '../lib/endpoint.js';
import { deleteAccount, getAccount } from '../lib/onedrive.js';
import { isSuper } from '../lib/roles.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  const a = await getAccount(input.accountId);
  if (!a || (a.ownerId !== user.id && !(await isSuper(user)))) throw new EndpointError('Unknown account.', { code: 'BAD_ACCOUNT' });
  await deleteAccount(a.id);
  await logActivity(user, 'onedrive.remove', a.email, '');
  return { ok: true };
}
