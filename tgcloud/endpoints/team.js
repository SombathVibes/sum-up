// The admin team for the Mini App (super admins): everyone in the admins table
// with their role in each group, and the groups to assign.

import { requireSuper } from '../lib/endpoint.js';
import { isConfigSuper, listAdmins, rolesOf, syncConfigSupers } from '../lib/roles.js';
import { listGroups } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  await syncConfigSupers();
  const groups = await listGroups();
  const tgIdOf = new Map(groups.map((g) => [g.id, g.tgId]));
  const admins = [];
  for (const a of await listAdmins()) {
    const roles = {};
    for (const [groupId, role] of await rolesOf(a.userId)) if (tgIdOf.has(groupId)) roles[tgIdOf.get(groupId)] = role;
    admins.push({
      userId: a.userId,
      name: a.name ?? null,
      username: a.username ?? null,
      isSuper: !!a.isSuper,
      config: isConfigSuper(a.userId), // set in config.js; can't be changed here
      roles, // group Telegram id → 'view' | 'manage'
    });
  }
  return { admins, groups: groups.map((g) => ({ tgId: g.tgId, name: g.name ?? String(g.tgId) })) };
}
