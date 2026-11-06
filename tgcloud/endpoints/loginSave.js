// Adds (no id) or updates a lottery login (super admins; managers: their own, a new one is theirs) and sends the sync
// helper the new schedule. An empty password keeps the saved one.

import { EndpointError } from 'sdk';
import { loginsOverview } from '../lib/agents.js';
import { requireLogin, requireLogins } from '../lib/endpoint.js';
import { checkLogin, saveLogin } from '../lib/logins.js';

export default async function (input, ctx) {
  const { user, role } = await requireLogins(ctx);
  if (Number(input.id)) await requireLogin(ctx, input.id);
  const { values, error } = checkLogin(input.login ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  let id;
  try {
    id = await saveLogin(Number(input.id) || null, values, { ownerId: user.id });
  } catch (e) {
    if (e.field) throw new EndpointError(`Check the ${e.field} field.`, { code: 'BAD_FIELD', field: e.field });
    throw e;
  }
  return { id, logins: await loginsOverview(role === 'super' ? {} : { ownerId: user.id }) };
}
