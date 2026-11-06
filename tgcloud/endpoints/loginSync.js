// Signs in with a lottery login and fetches its agents and members again
// (super admins; managers: their own): also how to check that a login works.

import { EndpointError } from 'sdk';
import { loginsOverview, memberOptions } from '../lib/agents.js';
import { requireLogin } from '../lib/endpoint.js';

export default async function (input, ctx) {
  const { user, role, login } = await requireLogin(ctx, input.id);
  try {
    await memberOptions(login);
  } catch (e) {
    throw new EndpointError(e.message, { code: 'LOGIN_FAILED' });
  }
  return { logins: await loginsOverview(role === 'super' ? {} : { ownerId: user.id }) };
}
