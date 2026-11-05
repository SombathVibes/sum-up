// Signs in with a lottery login and fetches its agents and members again
// (super admins): also how to check that a login works.

import { EndpointError } from 'sdk';
import { loginsOverview, memberOptions } from '../lib/agents.js';
import { requireSuper } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const login = await getLogin(Number(input.id), { secret: true });
  if (!login) throw new EndpointError('Unknown login.', { code: 'BAD_LOGIN' });
  try {
    await memberOptions(login);
  } catch (e) {
    throw new EndpointError(e.message, { code: 'LOGIN_FAILED' });
  }
  return { logins: await loginsOverview() };
}
