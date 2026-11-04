// Saves a group's Daily report settings (super admins) and sends the sync
// helper the new schedule.

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
  await saveDailyConfig(group.id, values);
  return { config: await dailyConfig(group.id) };
}
