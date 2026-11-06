// Deletes a lottery login (super admins; managers: their own); groups that followed it are switched off.

import { loginsOverview } from '../lib/agents.js';
import { dropLoginFromGroups } from '../lib/daily.js';
import { requireLogin } from '../lib/endpoint.js';
import { deleteLogin } from '../lib/logins.js';

export default async function (input, ctx) {
  const { user, role, login } = await requireLogin(ctx, input.id);
  const id = login.id;
  await dropLoginFromGroups(id);
  await deleteLogin(id);
  return { logins: await loginsOverview(role === 'super' ? {} : { ownerId: user.id }) };
}
