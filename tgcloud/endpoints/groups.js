// The caller's groups with their access and the last 30 days of totals, for the
// Mini App's group list (search, sorting and the expiring filter happen there).
// Groups with the 📥 lottery report on also get its last 30 days: 🎰 win/lose,
// 📤 សាង and 💵 the final result, from saved figures only (no API call: the
// list shows every group at once; opening a group fetches what's missing).

import { accessStatus } from '../lib/billing.js';
import { dailyConfig, groupSubject } from '../lib/daily.js';
import { addDays, dayKey, dayRange, startOf, today } from '../lib/dates.js';
import { requireAdmin } from '../lib/endpoint.js';
import { daysOf, lotteryRange } from '../lib/lotterysum.js';
import { visibleGroups } from '../lib/roles.js';
import { totalsByDay } from '../lib/store.js';

/** A group's lottery line for the list, or null when it's off (or can't be read). */
async function lottery30(group, range) {
  const cfg = await dailyConfig(group.id);
  if (!cfg.enabled || !cfg.memberCode || !cfg.loginId) return null;
  try {
    const r = await lotteryRange({ id: cfg.loginId }, await groupSubject(cfg), daysOf(range.start, range.end), { saved: true });
    return { wl: r.report.total.wl, send: r.send.total.wl, final: r.final, live: !!(r.report.today || r.send.today) };
  } catch (e) {
    console.error('group list lottery', group.tgId, e.message);
    return null;
  }
}

export default async function (input, ctx) {
  const user = await requireAdmin(ctx);
  const first = addDays(today(), -29);
  const range = { start: startOf(first), end: dayRange(today()).end };

  const out = [];
  for (const { group, role } of await visibleGroups(user)) {
    const status = await accessStatus(group);
    // Fill all 30 days so the chart has a bar for every day.
    const byDay = new Map();
    for (let i = 0; i < 30; i++) byDay.set(dayKey(addDays(first, i)), { day: dayKey(addDays(first, i)), KHR: 0, USD: 0, ops: 0 });
    for (const r of await totalsByDay(group.id, range)) {
      const d = byDay.get(r.day);
      if (d && r.currency in d) { d[r.currency] += r.total; d.ops += r.ops; }
    }
    out.push({
      tgId: group.tgId,
      name: group.name ?? String(group.tgId),
      role,
      lifetime: !!group.lifetime,
      status, // { kind, end, daysLeft } | { kind: 'lifetime' } | null (expired)
      last30: [...byDay.values()],
      lottery: await lottery30(group, range),
    });
  }
  return { groups: out };
}
