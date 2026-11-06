// Saves a group's 📤 auto-send settings (super admins; managers of the group
// whose lottery login is their own): on/off, time, which agents, 🖼 / 📊, and
// the ⚠️ alert amount. Whoever saves gets the alerts and the failures.

import { EndpointError } from 'sdk';
import { logActivity } from '../lib/activity.js';
import { loginAgents } from '../lib/agents.js';
import { autoSendConfig, checkAutoSend, saveAutoSend } from '../lib/autosend.js';
import { dailyConfig } from '../lib/daily.js';
import { requireGroup } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { ownsLogin } from '../lib/roles.js';

export default async function (input, ctx) {
  const { user, group, role } = await requireGroup(ctx, input.groupId, 'manage');
  const cfg = await dailyConfig(group.id);
  if (!cfg.loginId) throw new EndpointError('Link a lottery login to this group first.', { code: 'NO_LOGIN' });
  if (!ownsLogin(role === 'super' ? 'super' : 'manager', user, await getLogin(cfg.loginId))) {
    throw new EndpointError('This group follows another admin’s login.', { code: 'FORBIDDEN' });
  }
  const allowed = new Set((await loginAgents(cfg.loginId)).map((a) => a.id));
  const { values, error } = checkAutoSend(input.autoSend ?? {}, allowed);
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  await saveAutoSend(group.id, values, user.id);
  await logActivity(user, 'group.autosend', group.name ?? String(group.tgId),
    values.enabled ? `ON · ⏰ ${values.time} · ${[values.sendImage && '🖼', values.sendExcel && '📊'].filter(Boolean).join(' ')} · ${values.agentIds.length} agent(s)${values.alertAmount ? ` · ⚠️ ±${values.alertAmount}` : ''}` : 'OFF');
  const saved = await autoSendConfig(group.id);
  return { autoSend: { ...saved, setBy: undefined, mine: true } };
}
