// One group's totals for a date range: per day, per bank, overall, and the
// period of the same length just before it (for the change line).

import { WHITELIST_BOTS } from '../lib/config.js';
import { addDays, dayKey, dayOf } from '../lib/dates.js';
import { parseRange, requireGroup } from '../lib/endpoint.js';
import { accessStatus } from '../lib/billing.js';
import { totalsByBot, totalsByDay } from '../lib/store.js';

const sum = (rows) => rows.reduce((t, r) => {
  if (r.currency in t) t[r.currency] += r.total;
  t.ops += r.ops;
  return t;
}, { KHR: 0, USD: 0, ops: 0 });

export default async function (input, ctx) {
  const { group, role } = await requireGroup(ctx, input.groupId);
  const range = parseRange(input.from, input.to);
  const length = range.end - range.start + 1;
  const previous = { start: range.start - length, end: range.start - 1 };

  const days = [];
  const byDay = new Map();
  for (let d = dayOf(range.start); dayKey(d) <= range.to; d = addDays(d, 1)) {
    const e = { day: dayKey(d), KHR: 0, USD: 0, ops: 0 };
    byDay.set(e.day, e);
    days.push(e);
  }
  const [dayRows, botRows, prevRows, status] = await Promise.all([
    totalsByDay(group.id, range), totalsByBot(group.id, range), totalsByBot(group.id, previous), accessStatus(group),
  ]);
  for (const r of dayRows) {
    const e = byDay.get(r.day);
    if (e && r.currency in e) { e[r.currency] += r.total; e.ops += r.ops; }
  }

  const banks = new Map();
  for (const r of botRows) {
    if (!banks.has(r.botTgId)) banks.set(r.botTgId, { name: WHITELIST_BOTS[r.botTgId] ?? String(r.botTgId), KHR: 0, USD: 0, ops: 0 });
    const b = banks.get(r.botTgId);
    if (r.currency in b) b[r.currency] += r.total;
    b.ops += r.ops;
  }

  return {
    group: { tgId: group.tgId, name: group.name ?? String(group.tgId), role, status },
    from: range.from,
    to: range.to,
    days,
    banks: [...banks.values()],
    total: sum(botRows),
    previous: sum(prevRows),
  };
}
