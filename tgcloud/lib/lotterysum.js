// A group's lottery numbers for a range of days, for the Mini App: its
// member's 💰 totals (agent_daily_totals) as two sides, 🎰 the report and
// 📤 សាង, plus 💵 the final result (the report's win/lose less 📤's, which
// already is the user's share). The total reports fill a day only once it
// settles, so until then today counts with its saved by-draw report (📤: its
// user share, winLoseAmountKhrUser, as the settled day will give it).

import { savedSubjectTotals, subjectTotals } from './agents.js';
import { addDays, dayKey, dayOf, today } from './dates.js';
import { reportForDay, snapshotTotals } from './daily.js';

/** 'YYYY-MM-DD' days from a unix-time range (Phnom Penh), up to today. */
export function daysOf(start, end) {
  const todayKey = dayKey(today());
  const out = [];
  for (let d = dayOf(start); dayKey(d) <= dayKey(dayOf(end)) && dayKey(d) <= todayKey; d = addDays(d, 1)) out.push(dayKey(d));
  return out;
}

// The fields shown, in riel.
const pick = (t) => ({ bet: t.commissionKhr, reward: t.rewardAmountKhr, wl: t.winLoseAmountKhr });

/**
 * { report, send, final, missing, error } for `days`: report and send are
 * { total, perDay: [{ day, bet, reward, wl, live? }], today }, final is the
 * final win/lose. `login`: with secret, to fetch missing days (the group
 * screen); or `{ id }` with `saved: true`, saved days only (the group list).
 */
export async function lotteryRange(login, who, days, { saved = false } = {}) {
  const todayKey = dayKey(today());
  // Today is never fetched: its total report stays empty until the day settles,
  // and the saved by-draw report stands in for it (below). Fetching it anyway
  // cost the Mini App's lottery card ~1.4 s of lottery API calls per open.
  const past = days.filter((d) => d !== todayKey);
  const cur = saved ? await savedSubjectTotals(login.id, who, days) : await subjectTotals(login, who, past);
  const row = days.includes(todayKey) ? await reportForDay(login.id, todayKey, who.key) : null;
  const side = (field, send) => {
    const total = pick(cur[field]);
    const perDay = cur.perDay.filter((d) => d[field]).map((d) => ({ day: d.day, bet: d[field].commissionKhr, reward: d[field].rewardAmountKhr, wl: d[field].winLoseAmountKhr }));
    const settled = perDay.some((d) => d.day === todayKey && (d.bet || d.wl));
    const live = !settled && row ? snapshotTotals(row, { send }) : null;
    const todayLive = live && (live.bet || live.wl) ? { bet: live.bet, reward: live.reward, wl: send ? live.user : live.wl } : null;
    if (todayLive) {
      total.bet += todayLive.bet;
      total.reward += todayLive.reward;
      total.wl += todayLive.wl;
      perDay.push({ day: todayKey, ...todayLive, live: true });
    }
    return { total, perDay, today: todayLive };
  };
  const report = side('report', false);
  const send = side('send', true);
  return { report, send, final: report.total.wl - send.total.wl, missing: cur.missing, error: cur.error };
}
