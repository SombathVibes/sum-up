// Billing: groups that expired or end within 10 days, and per group the
// payment history and (for managers) recording a renewal.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { accessBadge, amount, dateOf, money } from '../format.js';

const tg = window.Telegram?.WebApp;
const MONTHS = [1, 3, 6, 12];

export default function Billing({ groups, onOpen }) {
  const urgent = groups
    .filter((g) => !g.status || (g.status.kind !== 'lifetime' && g.status.daysLeft <= 10))
    .sort((a, b) => (a.status?.daysLeft ?? -1) - (b.status?.daysLeft ?? -1));
  const others = groups.filter((g) => !urgent.includes(g));
  const row = (g) => {
    const badge = accessBadge(g.status);
    return (
      <button key={g.tgId} className="card row" onClick={() => onOpen(g.tgId)}>
        <strong className="name">🏪 {g.name}</strong>
        <span className="muted small">{g.status?.end ? `ដល់ ${dateOf(g.status.end)}` : ''}</span>
        <span className={`badge ${badge.tone}`}>{badge.text}</span>
      </button>
    );
  };
  return (
    <main className="content">
      <h2>⚠️ ផុតកំណត់ ឬជិតផុតកំណត់ ({urgent.length})</h2>
      {urgent.length ? urgent.map(row) : <p className="muted">គ្មានទេ — ក្រុមទាំងអស់នៅសុពលភាព។</p>}
      <h2>ក្រុមផ្សេងទៀត ({others.length})</h2>
      {others.map(row)}
    </main>
  );
}

const SOURCE = { trial: 'សាកល្បង', manual: 'បង់ដោយដៃ', stars: 'Telegram Stars' };

export function BillingPanel({ group, onChanged }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const canRenew = group.role === 'manage' || group.role === 'super';
  const [lifetime, setLifetime] = useState(group.lifetime);

  const toggleLifetime = () => {
    const on = !lifetime;
    const go = () => call('lifetime', { groupId: group.tgId, on })
      .then(() => { setLifetime(on); setDone(on ? '♾️ បានបើកសិទ្ធិអចិន្ត្រៃយ៍' : '✅ ត្រឡប់ទៅការជាវធម្មតា'); onChanged(); })
      .catch((e) => setDone(`⚠️ ${e.message}`));
    const text = on ? `ផ្តល់សិទ្ធិអចិន្ត្រៃយ៍ដល់ "${group.name}"? មិនផុតកំណត់ និងលាក់ប៊ូតុងជាវ។` : `ដកសិទ្ធិអចិន្ត្រៃយ៍ពី "${group.name}"?`;
    if (tg?.showConfirm) tg.showConfirm(text, (ok) => ok && go());
    else if (window.confirm(text)) go();
  };

  const load = () => call('groupHistory', { groupId: group.tgId }).then((r) => setHistory(r.periods), setError);
  useEffect(() => { load(); }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const renew = (months) => {
    const go = () => call('renew', { groupId: group.tgId, months })
      .then((r) => { setDone(`✅ បានកត់ត្រា ${months} ខែ · ${amount(r.price, r.currency === 'USD' ? 'USD' : 'KHR')} · ដល់ ${dateOf(r.end)}`); load(); onChanged(); })
      .catch((e) => setDone(`⚠️ ${e.message}`));
    const text = `កត់ត្រាការបង់ប្រាក់ ${months} ខែ សម្រាប់ "${group.name}"?`;
    if (tg?.showConfirm) tg.showConfirm(text, (ok) => ok && go());
    else if (window.confirm(text)) go();
  };

  return (
    <main className="content">
      {group.role === 'super' && (
        <section className="card row">
          <span>♾️ សិទ្ធិអចិន្ត្រៃយ៍</span>
          <button className={`btn small${lifetime ? '' : ' off'}`} onClick={toggleLifetime}>{lifetime ? 'ON' : 'OFF'}</button>
        </section>
      )}
      {lifetime
        ? <section className="card"><strong>♾️ អចិន្ត្រៃយ៍</strong><p className="muted">ក្រុមនេះមិនចាំបាច់បង់ប្រាក់ទេ។</p></section>
        : (
          <section className="card">
            <div className="muted small">សុពលភាពដល់</div>
            <strong>{group.status?.end ? dateOf(group.status.end) : 'ផុតកំណត់'}</strong>
            {canRenew && (
              <>
                <p className="muted small">អតិថិជនបានបង់ប្រាក់? កត់ត្រាចំនួនខែ៖</p>
                <div className="chips">{MONTHS.map((m) => <button key={m} className="chip" onClick={() => renew(m)}>🔄 {m} ខែ</button>)}</div>
              </>
            )}
            {done && <p className="small">{done}</p>}
          </section>
        )}
      <section className="card">
        <strong>🧾 ប្រវត្តិ</strong>
        {error && <p className="error">{error.message}</p>}
        {!history && !error && <p className="muted">កំពុងផ្ទុក…</p>}
        <ul className="payments">
          {history?.map((p) => (
            <li key={`${p.start}-${p.end}`} className="row">
              <span>{dateOf(p.start)} → {dateOf(p.end)}</span>
              <span className="muted small">{SOURCE[p.source] ?? p.source}{p.price ? ` · ${p.currency === 'XTR' ? `${p.price} ⭐` : `${money(p.price)} ${p.currency}`}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
