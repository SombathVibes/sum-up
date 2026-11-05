// Deletes a lottery login (super admins); groups that followed it are switched off.

import { loginsOverview } from '../lib/agents.js';
import { dropLoginFromGroups } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { deleteLogin } from '../lib/logins.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const id = Number(input.id);
  await dropLoginFromGroups(id);
  await deleteLogin(id);
  return { logins: await loginsOverview() };
}
