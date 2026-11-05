// One group's lottery totals for a date range (the Mini App's group report),
// when a super admin switched the 📥 lottery report on for it: its member's
// 💰 totals, the same numbers as the bot's 💰 សរុប (agent_daily_totals,
// missing days fetched), and the period of the same length before it. The
// total reports fill a day only once it settles, so until then today counts
// with its saved by-draw report, both sides (today / todaySend: those
// numbers, or null).

import { addDays, dayKey, dayOf, today } from '../lib/dates.js';
import { dailyConfig, groupSubject, reportForDay, snapshotTotals, subjectLabel } from '../lib/daily.js';
import { parseRange, requireGroup } from '../lib/endpoint.js';
import { getLogin } from '../lib/logins.js';
import { subjectTotals } from '../lib/agents.js';

const daysOf = (start, end) => {
  const out = [];
  for (let d = dayOf(start); dayKey(d) <= dayKey(dayOf(end)); d = addDays(d, 1)) out.push(dayKey(d));
  return out;
};

// The fields the page shows, in riel.
const pick = (t) => ({ bet: t.commissionKhr, reward: t.rewardAmountKhr, wl: t.winLoseAmountKhr });

export default async function (input, ctx) {
  const { group } = await requireGroup(ctx, input.groupId);
  const cfg = await dailyConfig(group.id);
  if (!cfg.enabled || !cfg.memberCode) return { enabled: false };
  const login = await getLogin(cfg.loginId, { secret: true });
  if (!login) return { enabled: true, error: 'The group’s lottery login was deleted.' };

  const range = parseRange(input.from, input.to);
  const length = range.end - range.start + 1;
  const todayKey = dayKey(today());
  const days = daysOf(range.start, range.end).filter((d) => d <= todayKey);
  const before = daysOf(range.start - length, range.start - 1);
  const who = await groupSubject(cfg);

  let cur;
  try {
    cur = await subjectTotals(login, who, days);
  } catch (e) {
    return { enabled: true, member: subjectLabel(who), error: e.message };
  }
  const prev = await subjectTotals(login, who, before).catch(() => null);
  const report = pick(cur.report);
  const send = pick(cur.send);
  const perDay = cur.perDay.filter((d) => d.report || d.send).map((d) => ({ day: d.day, bet: d.report?.commissionKhr ?? 0, wl: d.report?.winLoseAmountKhr ?? 0 }));
  // Today before it settles: its by-draw numbers instead.
  const settled = perDay.some((d) => d.day === todayKey && (d.bet || d.wl));
  const saved = days.includes(todayKey) && !settled ? await reportForDay(login.id, todayKey, who.key) : null;
  const has = (t) => t && (t.bet || t.wl) ? t : null;
  const live = has(snapshotTotals(saved));
  const liveSend = has(snapshotTotals(saved, { send: true }));
  const add = (into, t) => Object.assign(into, { bet: into.bet + t.bet, reward: into.reward + t.reward, wl: into.wl + t.wl });
  if (live) {
    add(report, live);
    perDay.push({ day: todayKey, bet: live.bet, wl: live.wl, live: true });
  }
  if (liveSend) add(send, liveSend);

  return {
    enabled: true,
    member: subjectLabel(who),
    report,
    send,
    previous: prev && !prev.missing ? pick(prev.report) : null,
    perDay,
    today: live && { bet: live.bet, reward: live.reward, wl: live.wl },
    todaySend: liveSend && { bet: liveSend.bet, reward: liveSend.reward, wl: liveSend.wl },
    missing: cur.missing,
    error: cur.error,
  };
}
