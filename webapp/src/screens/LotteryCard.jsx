// A group's lottery totals for the report's date range (groupLottery), shown
// only when the 📥 lottery report is on for the group: two cards, 🎰 ឆ្នោត
// and 📤 សាង, each with the member's bet, payout and profit or loss, the
// change from the period before, and the days folded; then 💵 the final
// result (profit less 📤's user share, e.g. 40%). Today counts with its
// by-draw numbers until its totals settle, which each card says.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { amount, shortDay } from '../format.js';

const riel = (n) => amount(Math.round(Number(n) || 0) * 100, 'KHR');
const profit = (wl) => (wl < 0 ? `📉 ខាត ${riel(-wl)}` : `📈 ចំណេញ ${riel(wl)}`);

function versus(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return <span className={pct < 0 ? 'down' : 'up'}>{pct > 0 ? '+' : ''}{pct}%</span>;
}

/** One side (side: { total, previous, perDay, today }) as a card. */
function SideCard({ title, member, side, missing, error }) {
  const { total, previous, perDay, today } = side;
  const empty = !total.bet && !total.reward && !total.wl;
  return (
    <section className="card lottery">
      <div className="row">
        <strong>{title}</strong>
        {member && <span className="muted small">{member}</span>}
      </div>
      {empty ? (
        <p className="muted small">មិនមានការចាក់ក្នុងរយៈពេលនេះទេ។</p>
      ) : (
        <div className="totals">
          <div><div className="muted small">ចាក់</div><strong>{riel(total.bet)}</strong></div>
          <div><div className="muted small">សង</div><strong>{riel(total.reward)}</strong></div>
          <div>
            <div className="muted small">{total.wl < 0 ? 'ខាត' : 'ចំណេញ'}</div>
            <strong className={total.wl < 0 ? 'bad' : 'ok'}>{riel(Math.abs(total.wl))}</strong>
            {versus(total.wl, previous?.wl)}
          </div>
        </div>
      )}
      {today && (
        <p className="muted small">🔴 រួមទាំងថ្ងៃនេះតាមរបាយការណ៍ប្រចាំវេន (ចាក់ {riel(today.bet)} · {profit(today.wl)}) — តួលេខពិតចូលក្រោយបិទថ្ងៃ។</p>
      )}
      {missing > 0 && <p className="muted small">⏳ ខ្វះ {missing} ថ្ងៃ{error ? ` — ${error}` : ''} · បើកម្ដងទៀតដើម្បីបន្ត។</p>}
      {perDay.length > 0 && (
        <details className="days">
          <summary className="small">ប្រចាំថ្ងៃ ({perDay.length})</summary>
          <table className="table">
            <thead><tr><th>Day</th><th>Bet</th><th>សង</th><th>W/L</th></tr></thead>
            <tbody>{perDay.map((d) => (
              <tr key={d.day}><td>{shortDay(d.day)}{d.live ? ' 🔴' : ''}</td><td>{riel(d.bet)}</td><td>{riel(d.reward)}</td><td className={d.wl < 0 ? 'bad' : ''}>{riel(d.wl)}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </section>
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
  if (!data || !data.report) {
    return (
      <section className="card lottery">
        <strong>🎰 ឆ្នោត</strong>
        {error && <p className="error">{error.message}</p>}
        {data?.error && <p className="error">{data.error}</p>}
        {!data && !error && <p className="muted small">កំពុងផ្ទុក…</p>}
      </section>
    );
  }
  return (
    <>
      <SideCard title="🎰 ឆ្នោត" member={data.member} side={data.report} missing={data.missing} error={data.error} />
      <SideCard title="📤 សាង" member={data.member} side={data.send} />
      {(data.send.total.bet !== 0 || data.send.total.wl !== 0) && (
        <section className="card lottery">
          <div className="row">
            <strong>💵 សរុបចុងក្រោយ</strong>
            <span className="muted small">ចំណេញ − សាង</span>
          </div>
          <div className="totals">
            <div>
              <div className="muted small">{data.final.wl < 0 ? 'ខាត' : 'ចំណេញ'}</div>
              <strong className={data.final.wl < 0 ? 'bad' : 'ok'}>{riel(Math.abs(data.final.wl))}</strong>
              {versus(data.final.wl, data.final.previous)}
            </div>
          </div>
          <p className="muted small">{riel(data.report.total.wl)} {data.send.total.wl < 0 ? '+' : '−'} សាង {riel(Math.abs(data.send.total.wl))}</p>
        </section>
      )}
    </>
  );
}
