// All groups the admin may see: search, filter by access, sort, and a 30-day chart each.

import { useMemo, useState } from 'react';
import BarChart from '../components/BarChart.jsx';
import { accessBadge, amount } from '../format.js';

const FILTERS = [
  ['all', 'ទាំងអស់'],
  ['soon', '⚠️ ជិតផុត'],
  ['expired', 'ផុតកំណត់'],
];
const SORTS = [
  ['name', 'ឈ្មោះ'],
  ['days', 'ថ្ងៃនៅសល់'],
  ['total', 'ប្រាក់ ៣០ ថ្ងៃ'],
];

const daysLeft = (g) => (!g.status ? -1 : g.status.kind === 'lifetime' ? Infinity : g.status.daysLeft);
const sum30 = (g) => g.last30.reduce((t, d) => t + d.KHR, 0);

export default function Groups({ groups, onOpen }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('days');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .filter((g) => !needle || g.name.toLowerCase().includes(needle))
      .filter((g) => filter === 'all'
        || (filter === 'expired' && !g.status)
        || (filter === 'soon' && g.status && g.status.kind !== 'lifetime' && g.status.daysLeft <= 10))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'total' ? sum30(b) - sum30(a)
          : daysLeft(a) - daysLeft(b)));
  }, [groups, q, filter, sort]);

  return (
    <main className="content">
      <input className="search" type="search" placeholder="🔍 ស្វែងរកក្រុម…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {FILTERS.map(([k, label]) => <button key={k} className={filter === k ? 'chip on' : 'chip'} onClick={() => setFilter(k)}>{label}</button>)}
        <select className="chip" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map(([k, label]) => <option key={k} value={k}>↕ {label}</option>)}
        </select>
      </div>
      <p className="muted small">{shown.length} / {groups.length} ក្រុម</p>
      {shown.map((g) => {
        const badge = accessBadge(g.status);
        const usd = g.last30.reduce((t, d) => t + d.USD, 0);
        const ops = g.last30.reduce((t, d) => t + d.ops, 0);
        return (
          <button key={g.tgId} className="card group" onClick={() => onOpen(g.tgId)}>
            <div className="row">
              <strong className="name">🏪 {g.name}</strong>
              <span className={`badge ${badge.tone}`}>{badge.text}</span>
            </div>
            <BarChart days={g.last30} compact height={40} />
            <div className="row muted small">
              <span>៣០ ថ្ងៃ: {amount(sum30(g), 'KHR')}{usd ? ` · ${amount(usd, 'USD')}` : ''}</span>
              <span>{ops} ប្រតិ.{g.role === 'view' ? ' · 👁' : ''}</span>
            </div>
          </button>
        );
      })}
      {!shown.length && <p className="center muted">មិនមានក្រុមទេ។</p>}
    </main>
  );
}
