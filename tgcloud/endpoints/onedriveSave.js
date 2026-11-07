// ☁️ Saves a group's OneDrive copy: on/off, account (one this person connected,
// any for super admins, or the group's current one), folder.

import { EndpointError } from 'sdk';
import { logActivity } from '../lib/activity.js';
import { requireGroup } from '../lib/endpoint.js';
import { cleanFolder, defaultFolder, getAccount, groupOnedriveConfig, saveGroupOnedrive } from '../lib/onedrive.js';

export default async function (input, ctx) {
  const { user, group, role } = await requireGroup(ctx, input.groupId, 'manage');
  const cur = await groupOnedriveConfig(group.id);
  const accountId = Number(input.accountId) || 0;
  const enabled = !!input.enabled;
  if (enabled && !accountId) throw new EndpointError('Pick a OneDrive account.', { code: 'BAD_FIELD', field: 'account' });
  if (accountId && accountId !== cur.accountId) {
    const a = await getAccount(accountId);
    if (!a || (role !== 'super' && a.ownerId !== user.id)) throw new EndpointError('Pick a OneDrive account.', { code: 'BAD_FIELD', field: 'account' });
  }
  const folder = cleanFolder(input.folder) || defaultFolder(group.name);
  await saveGroupOnedrive(group.id, { enabled, accountId, folder }, user.id);
  const a = accountId ? await getAccount(accountId) : null;
  await logActivity(user, 'group.onedrive', group.name ?? String(group.tgId), enabled ? `ON · ${a?.email ?? accountId} · ${folder}` : 'OFF');
  return { config: { enabled, accountId, folder } };
}
