// Saves a group's lottery report settings (super admins; managers of the
// group, with their own logins): on/off, and which
// login and member it follows.

import { EndpointError } from 'sdk';
import { checkDaily, dailyConfig, saveDailyConfig } from '../lib/daily.js';
import { requireGroup } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { ownsLogin } from '../lib/roles.js';

export default async function (input, ctx) {
  const { user, group, role } = await requireGroup(ctx, input.groupId, 'manage');
  const as = role === 'super' ? 'super' : 'manager';
  const { values, error } = checkDaily(input.config ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  // A manager: only their own logins, and not over a group set to someone else's.
  if (as === 'manager') {
    const current = (await dailyConfig(group.id)).loginId;
    if (current && !ownsLogin(as, user, await getLogin(current))) throw new EndpointError('This group follows another admin’s login.', { code: 'FORBIDDEN' });
    if (values.loginId && !ownsLogin(as, user, await getLogin(values.loginId))) throw new EndpointError('Check the member field.', { code: 'BAD_FIELD', field: 'member' });
  }
  try {
    await saveDailyConfig(group.id, values);
  } catch (e) {
    if (e.field) throw new EndpointError(`Check the ${e.field} field.`, { code: 'BAD_FIELD', field: e.field });
    throw e;
  }
  return { config: await dailyConfig(group.id) };
}
