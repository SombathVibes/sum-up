// The lottery logins (super admins: all; managers: the ones they added): each with its agents and members saved
// under it and how many groups follow it. Never the password or token.

import { loginsOverview } from '../lib/agents.js';
import { requireLogins } from '../lib/endpoint.js';
import { loginDefaults } from '../lib/logins.js';

export default async function (input, ctx) {
  const { user, role } = await requireLogins(ctx);
  return {
    logins: await loginsOverview(role === 'super' ? {} : { ownerId: user.id }),
    // New logins start from these (super admins can change them).
    defaults: await loginDefaults(),
    canEditDefaults: role === 'super',
  };
}
