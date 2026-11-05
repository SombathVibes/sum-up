// The members a group's 📥 report can follow (super admins): every agent under
// the group's report login, each with its members, for the Mini App's picker.

import { EndpointError } from 'sdk';
import { memberOptions } from '../lib/agents.js';
import { requireSuper } from '../lib/endpoint.js';
import { getGroup } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const group = await getGroup(Number(input.groupId));
  if (!group) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  try {
    return { agents: await memberOptions(group) };
  } catch (e) {
    throw new EndpointError(e.message, { code: 'NO_LOGIN' });
  }
}
