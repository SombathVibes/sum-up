// One group's payments in a date range, newest first, searchable and paged.

import { WHITELIST_BOTS } from '../lib/config.js';
import { parseRange, requireGroup } from '../lib/endpoint.js';
import { paymentsPage } from '../lib/store.js';

export default async function (input, ctx) {
  const { group } = await requireGroup(ctx, input.groupId);
  const range = parseRange(input.from, input.to);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const q = String(input.q ?? '').trim().slice(0, 100);
  const page = await paymentsPage(group.id, range, { q, offset, limit });
  return {
    total: page.total,
    items: page.items.map((p) => ({ ...p, bank: WHITELIST_BOTS[p.botTgId] ?? String(p.botTgId) })),
  };
}
