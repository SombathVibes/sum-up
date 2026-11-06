// Adds (no id) or updates a lottery login (super admins; managers: their own, a new one is theirs) and sends the sync
// helper the new schedule. An empty password keeps the saved one.

import { EndpointError } from 'sdk';
import { loginsOverview, memberOptions } from '../lib/agents.js';
import { requireLogin, requireLogins } from '../lib/endpoint.js';
import { checkLogin, getLogin, saveLogin, withDefaults } from '../lib/logins.js';

export default async function (input, ctx) {
  const { user, role } = await requireLogins(ctx);
  if (Number(input.id)) await requireLogin(ctx, input.id);
  // A new login takes the defaults (API URL, Basic, headers) it leaves empty.
  const form = Number(input.id) ? input.login ?? {} : await withDefaults(input.login ?? {});
  const { values, error } = checkLogin(form);
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  let id;
  try {
    id = await saveLogin(Number(input.id) || null, values, { ownerId: user.id });
  } catch (e) {
    if (e.field) throw new EndpointError(`Check the ${e.field} field.`, { code: 'BAD_FIELD', field: e.field });
    throw e;
  }
  // Saving also checks it: sign in and fetch its agents and members (so the
  // groups can pick a member straight away), or say why not.
  let check;
  try {
    const people = await memberOptions(await getLogin(id, { secret: true }));
    check = { ok: true, agents: people.length, members: people.reduce((n, a) => n + a.members.length, 0) };
  } catch (e) {
    check = { ok: false, error: String(e.message ?? e).slice(0, 300) };
  }
  return { id, check, logins: await loginsOverview(role === 'super' ? {} : { ownerId: user.id }) };
}
