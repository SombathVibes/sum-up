// ☁️ A group's Google Drive copy of its 📊 Excel files (the group's 🛠 managers and
// super admins): on/off, which connected account, which folder; and the
// accounts this person may pick (super admins: all; others: their own).

import { requireGroup } from '../lib/endpoint.js';
import { defaultFolder, getAccount, groupGdriveConfig, listAccounts, gdriveReady } from '../lib/gdrive.js';

export default async function (input, ctx) {
  const { user, group, role } = await requireGroup(ctx, input.groupId, 'manage');
  const [cfg, accounts] = await Promise.all([groupGdriveConfig(group.id), listAccounts(user, role === 'super')]);
  // The group's account, even when someone else connected it: shown, kept if unchanged.
  if (cfg.accountId && !accounts.some((a) => a.id === cfg.accountId)) {
    const a = await getAccount(cfg.accountId);
    if (a) accounts.push({ id: a.id, email: a.email, name: a.name, error: a.error, mine: false });
  }
  return {
    ready: gdriveReady(),
    config: { enabled: cfg.enabled, accountId: cfg.accountId, folder: cfg.folder || defaultFolder(group.name) },
    accounts,
  };
}
