// The lottery logins (super admins): each with its agents and members saved
// under it and how many groups follow it. Never the password or token.

import { loginsOverview } from '../lib/agents.js';
import { requireSuper } from '../lib/endpoint.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  return { logins: await loginsOverview() };
}
