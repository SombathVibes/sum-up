// 🔗 Linking a lottery login to groups in one place: the caller's groups they
// can set (super admins: every group; managers: the groups they manage), each
// with its lottery settings, and the login's agents and members to pick from.
// Saving a row is dailySave.

import { loginsOverview } from '../lib/agents.js';
import { dailyConfig } from '../lib/daily.js';
import { requireLogin } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { ownsLogin, visibleGroups } from '../lib/roles.js';

export default async function (input, ctx) {
  const { user, role, login } = await requireLogin(ctx, input.loginId);
  const mine = (await visibleGroups(user)).filter((g) => g.role === 'super' || g.role === 'manage');
  const groups = await Promise.all(mine.map(async ({ group }) => {
    const config = await dailyConfig(group.id);
    // Following someone else's login: shown, but only a super admin can change it.
    const locked = !!config.loginId && config.loginId !== login.id && !ownsLogin(role, user, await getLogin(config.loginId));
    return { tgId: group.tgId, name: group.name ?? String(group.tgId), config, locked };
  }));
  const people = (await loginsOverview({ ownerId: role === 'super' ? null : user.id })).find((l) => l.id === login.id)?.people ?? [];
  return { groups, people };
}
