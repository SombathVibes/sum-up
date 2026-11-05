// Saves a group's lottery report settings (super admins): on/off, and which
// login and member it follows.

import { EndpointError } from 'sdk';
import { checkDaily, dailyConfig, saveDailyConfig } from '../lib/daily.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const { values, error } = checkDaily(input.config ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  try {
    await saveDailyConfig(group.id, values);
  } catch (e) {
    if (e.field) throw new EndpointError(`Check the ${e.field} field.`, { code: 'BAD_FIELD', field: e.field });
    throw e;
  }
  return { config: await dailyConfig(group.id) };
}
