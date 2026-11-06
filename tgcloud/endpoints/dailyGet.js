// A group's lottery report settings (super admins; managers of the group,
// with their own logins): on/off, and which login
// and member it follows; plus the logins with their saved agents and members
// to pick from (no API call).

import { loginsOverview } from '../lib/agents.js';
import { dailyConfig } from '../lib/daily.js';
import { requireGroup } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { ownsLogin } from '../lib/roles.js';

export default async function (input, ctx) {
  const { user, group, role } = await requireGroup(ctx, input.groupId, 'manage');
  const as = role === 'super' ? 'super' : 'manager';
  const logins = (await loginsOverview(as === 'super' ? {} : { ownerId: user.id })).map((l) => ({ id: l.id, username: l.username, baseUrl: l.baseUrl, enabled: l.enabled, people: l.people }));
  const config = await dailyConfig(group.id);
  // A group following someone else's login: a manager sees it's on, but can't change it.
  const locked = !!config.loginId && !ownsLogin(as, user, await getLogin(config.loginId));
  return { config, logins, locked };
}
