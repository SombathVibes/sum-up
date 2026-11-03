// A group's subscription periods (payment history), newest first.

import { requireGroup } from '../lib/endpoint.js';
import { subscriptionHistory } from '../lib/store.js';

export default async function (input, ctx) {
  const { group, role } = await requireGroup(ctx, input.groupId);
  const rows = await subscriptionHistory(group.id, 50);
  return {
    role,
    periods: rows.map((r) => ({
      start: r.startDate, end: r.endDate, source: r.isTrial ? 'trial' : r.source,
      price: r.price, currency: r.currency, recordedBy: r.recordedBy, payerId: r.payerId,
    })),
  };
}
