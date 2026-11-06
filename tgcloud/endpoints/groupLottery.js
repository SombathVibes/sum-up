// One group's lottery numbers for a date range (the Mini App's group report),
// when a super admin switched the 📥 lottery report on for it: its member's
// 💰 totals, the same numbers as the bot's 💰 សរុប (missing days fetched),
// as 🎰 report and 📤 សាង sides and 💵 the final result, each with the period
// of the same length before it (lib/lotterysum.js).

import { dailyConfig, groupSubject, subjectLabel } from '../lib/daily.js';
import { parseRange, requireGroup } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { daysOf, lotteryRange } from '../lib/lotterysum.js';

export default async function (input, ctx) {
  const { group } = await requireGroup(ctx, input.groupId);
  const cfg = await dailyConfig(group.id);
  if (!cfg.enabled || !cfg.memberCode) return { enabled: false };
  const login = await getLogin(cfg.loginId, { secret: true });
  if (!login) return { enabled: true, error: 'The group’s lottery login was deleted.' };

  const range = parseRange(input.from, input.to);
  const length = range.end - range.start + 1;
  const who = await groupSubject(cfg);
  // This period and the one before it, at once.
  const [cur, prev] = await Promise.all([
    lotteryRange(login, who, daysOf(range.start, range.end)).catch((e) => ({ failed: e })),
    lotteryRange(login, who, daysOf(range.start - length, range.start - 1)).catch(() => null),
  ]);
  if (cur.failed) return { enabled: true, member: subjectLabel(who), error: cur.failed.message };
  const before = prev && !prev.missing ? prev : null;
  return {
    enabled: true,
    member: subjectLabel(who),
    report: { ...cur.report, previous: before && before.report.total },
    send: { ...cur.send, previous: before && before.send.total },
    final: { wl: cur.final, previous: before && before.final },
    missing: cur.missing,
    error: cur.error,
  };
}
