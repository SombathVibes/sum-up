// 📜 The activity log (super admins): the latest changes, newest first.

import { recentActivity } from '../lib/activity.js';
import { requireSuper } from '../lib/endpoint.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const items = await recentActivity(200);
  return { items: items.map(({ at, userName, userId, action, target, detail }) => ({ at, who: userName || String(userId), action, target, detail })) };
}
