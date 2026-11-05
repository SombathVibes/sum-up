// A group's lottery numbers for the report's date range (groupLottery), shown
// only when the 📥 lottery report is on for the group: one summary card at the
// top of the report. 💵 the final result first (win/lose less 📤 សាង's user
// share) with how it adds up, then 🎰 the report and 📤 សាង (bet, payout,
// profit or loss, each with the change from the period before), and the days
// folded. Today counts with its by-draw numbers until its totals settle,
// which the card says.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { riel, shortDay } from '../format.js';
import { SkeletonCard } from '../components/Skeleton.jsx';

const profit = (wl) => (wl < 0 ? `📉 ខាត ${riel(-wl)}` : `📈 ចំណេញ ${riel(wl)}`);

function versus(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return <span className={pct < 0 ? 'down' : 'up'}>{pct > 0 ? '+' : ''}{pct}%</span>;
}

/** One side's bet, payout and profit or loss in a row of three. */
function Side({ title, side }) {
  const { total, previous } = side;
  return (
    <div className="side">
      <div className="small"><strong>{title}</strong></div>
      <div className="totals">
        <div><div className="muted small">ចាក់</div><strong>{riel(total.bet)}</strong></div>
        <div><div className="muted small">សង</div><strong>{riel(total.reward)}</strong></div>
        <div>
          <div className="muted small">{total.wl < 0 ? 'ខាត' : 'ចំណេញ'}</div>
          <strong className={total.wl < 0 ? 'bad' : 'ok'}>{riel(Math.abs(total.wl))}</strong>
          {versus(total.wl, previous?.wl)}
        </div>
      </div>
    </div>
  );
}

export default function LotteryCard({ groupId, range }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    call('groupLottery', { groupId, ...range }).then(setData, setError);
  }, [groupId, range]);

  if (data && !data.enabled) return null;
  const head = (
    <div className="row">
      <strong>🎰 របាយការណ៍ឆ្នោត</strong>
      {data?.member && <span className="muted small">{data.member}</span>}
    </div>
  );
  // Loading: a placeholder in the summary's shape (missing days may be fetched first).
  if (!data && !error) return <SkeletonCard lines={4} className="lottery" />;
  if (!data || !data.report) {
    return (
      <section className="card lottery">
        {head}
        {error && <p className="error">{error.message}</p>}
        {data?.error && <p className="error">{data.error}</p>}
      </section>
    );
  }

  const { report, send, final } = data;
  const empty = (s) => !s.total.bet && !s.total.reward && !s.total.wl;
  const hasSend = !empty(send);
  const live = report.today || send.today;
  // One row per day: the report's win/lose, 📤's, and the final result.
  const days = new Map();
  for (const [field, s] of [['wl', report], ['send', send]]) {
    for (const d of s.perDay) {
      const row = days.get(d.day) ?? { day: d.day, wl: 0, send: 0, live: false };
      row[field] += d.wl;
      row.live ||= !!d.live;
      days.set(d.day, row);
    }
  }
  const perDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <section className="card lottery">
      {head}
      {empty(report) && !hasSend ? (
        <p className="muted small">មិនមានការចាក់ក្នុងរយៈពេលនេះទេ។</p>
      ) : (
        <>
          <div className="final">
            <div className="muted small">💵 សរុបចុងក្រោយ</div>
            <strong className={`big ${final.wl < 0 ? 'bad' : 'ok'}`}>{profit(final.wl)}</strong>
            {versus(final.wl, final.previous)}
            {hasSend && <div className="muted small">{riel(report.total.wl)} {send.total.wl < 0 ? '+' : '−'} សាង {riel(Math.abs(send.total.wl))}</div>}
          </div>
          <Side title="🎰 ឆ្នោត" side={report} />
          {hasSend && <Side title="📤 សាង" side={send} />}
          {live && <p className="muted small">🔴 រួមទាំងថ្ងៃនេះតាមរបាយការណ៍ប្រចាំវេន — តួលេខពិតចូលក្រោយបិទថ្ងៃ។</p>}
          {data.missing > 0 && <p className="muted small">⏳ ខ្វះ {data.missing} ថ្ងៃ{data.error ? ` — ${data.error}` : ''} · បើកម្ដងទៀតដើម្បីបន្ត។</p>}
          {perDay.length > 0 && (
            <details className="days">
              <summary className="small">ប្រចាំថ្ងៃ ({perDay.length})</summary>
              <table className="table">
                <thead><tr><th>ថ្ងៃ</th><th>🎰</th>{hasSend && <th>📤</th>}<th>💵</th></tr></thead>
                <tbody>{perDay.map((d) => (
                  <tr key={d.day}>
                    <td>{shortDay(d.day)}{d.live ? ' 🔴' : ''}</td>
                    <td className={d.wl < 0 ? 'bad' : ''}>{riel(d.wl)}</td>
                    {hasSend && <td>{riel(d.send)}</td>}
                    <td className={d.wl - d.send < 0 ? 'bad' : 'ok'}>{riel(d.wl - d.send)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
