// One group: a report for any date range (totals, change, the lottery
// totals when that's on, chart, banks, searchable payments, CSV to chat) and
// its billing (history, renew).

import { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';
import BarChart from '../components/BarChart.jsx';
import { accessBadge, addDays, amount, change, dateOf, monthBounds, timeOf, todayKey } from '../format.js';
import { BillingPanel } from './Billing.jsx';
import DailyPanel from './Daily.jsx';
import LotteryCard from './LotteryCard.jsx';

const tg = window.Telegram?.WebApp;

function presets() {
  const t = todayKey();
  return [
    ['ថ្ងៃនេះ', { from: t, to: t }],
    ['៧ ថ្ងៃ', { from: addDays(t, -6), to: t }],
    ['៣០ ថ្ងៃ', { from: addDays(t, -29), to: t }],
    ['ខែនេះ', monthBounds(t)],
    ['ខែមុន', monthBounds(t, -1)],
  ];
}

function Change({ cur, prev, currency }) {
  const c = change(cur, prev);
  if (!c) return null;
  return <span className={c.startsWith('-') ? 'down' : 'up'}>{currency === 'USD' ? '$' : '៛'} {c}</span>;
}

export default function Group({ group, startView, onClose, onChanged }) {
  const [view, setView] = useState(startView);
  const [range, setRange] = useState(presets()[2][1]);
  const [report, setReport] = useState(null);
  const [currency, setCurrency] = useState('KHR');
  const [error, setError] = useState(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    call('groupReport', { groupId: group.tgId, ...range }).then(setReport, setError);
  }, [group.tgId, range]);

  const badge = accessBadge(group.status);
  return (
    <div className="app">
      <header className="header">
        <button className="icon" onClick={onClose} aria-label="Back">←</button>
        <div className="grow">
          <div className="title">🏪 {group.name}</div>
          <span className={`badge ${badge.tone}`}>{badge.text}</span>
        </div>
      </header>
      <div className="segmented">
        <button className={view === 'report' ? 'on' : ''} onClick={() => setView('report')}>📊 របាយការណ៍</button>
        <button className={view === 'billing' ? 'on' : ''} onClick={() => setView('billing')}>⭐ ការជាវ</button>
        {group.role === 'super' && <button className={view === 'daily' ? 'on' : ''} onClick={() => setView('daily')}>📥 ឆ្នោត</button>}
      </div>

      {view === 'daily' && <DailyPanel group={group} />}
      {view === 'billing' && <BillingPanel group={group} onChanged={onChanged} />}
      {view === 'report' && (
        <main className="content">
          <div className="chips">
            {presets().map(([label, r]) => (
              <button key={label} className={r.from === range.from && r.to === range.to ? 'chip on' : 'chip'} onClick={() => setRange(r)}>{label}</button>
            ))}
          </div>
          <div className="row dates">
            <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            <span className="muted">→</span>
            <input type="date" value={range.to} min={range.from} max={todayKey()} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          </div>

          {error && <p className="error">{error.message}</p>}
          {!report && !error && <p className="center muted">កំពុងផ្ទុក…</p>}
          {report && (
            <>
              <section className="card totals">
                <div><div className="muted small">KHR</div><strong>{amount(report.total.KHR, 'KHR')}</strong><Change cur={report.total.KHR} prev={report.previous.KHR} currency="KHR" /></div>
                <div><div className="muted small">USD</div><strong>{amount(report.total.USD, 'USD')}</strong><Change cur={report.total.USD} prev={report.previous.USD} currency="USD" /></div>
                <div><div className="muted small">ប្រតិ.</div><strong>{report.total.ops}</strong></div>
              </section>
              <p className="muted small">ធៀបនឹងរយៈពេលស្មើគ្នាមុននេះ</p>

              <LotteryCard groupId={group.tgId} range={range} />

              <section className="card">
                <div className="row">
                  <strong>ប្រចាំថ្ងៃ</strong>
                  <div className="segmented small">
                    {['KHR', 'USD'].map((c) => <button key={c} className={currency === c ? 'on' : ''} onClick={() => setCurrency(c)}>{c}</button>)}
                  </div>
                </div>
                <BarChart days={report.days} currency={currency} />
              </section>

              {report.banks.length > 0 && (
                <section className="card">
                  <strong>ធនាគារ</strong>
                  <table className="table">
                    <thead><tr><th>Bank</th><th>Ops</th><th>KHR</th><th>USD</th></tr></thead>
                    <tbody>{report.banks.map((b) => <tr key={b.name}><td>{b.name}</td><td>{b.ops}</td><td>{amount(b.KHR, 'KHR')}</td><td>{amount(b.USD, 'USD')}</td></tr>)}</tbody>
                  </table>
                </section>
              )}

              <Payments groupId={group.tgId} range={range} total={report.total.ops} />
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Payments({ groupId, range, total }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const load = useCallback((offset, query) => {
    setBusy(true);
    call('groupPayments', { groupId, ...range, q: query, offset, limit: 50 })
      .then((r) => { setItems((prev) => (offset ? [...prev, ...r.items] : r.items)); setCount(r.total); })
      .finally(() => setBusy(false));
  }, [groupId, range]);

  // Search as you type, with a short pause so every keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => load(0, q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const sendCsv = () => {
    setSent('…');
    call('sendCsv', { groupId, ...range })
      .then((r) => { setSent(`✅ បានផ្ញើ ${r.sent} ជួរ ទៅ chat`); tg?.HapticFeedback?.notificationOccurred('success'); })
      .catch((e) => setSent(`⚠️ ${e.message}`));
  };

  return (
    <section className="card">
      <div className="row">
        <strong>ប្រតិបត្តិការ</strong>
        <button className="btn small" onClick={sendCsv} disabled={!total || sent === '…'}>📤 CSV ទៅ chat</button>
      </div>
      {sent && <p className="muted small">{sent}</p>}
      <input className="search" type="search" placeholder="🔍 ឈ្មោះ, លេខ, ចំនួន…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted small">{count} ប្រតិបត្តិការ</p>
      <ul className="payments">
        {items.map((p, i) => (
          <li key={`${p.date}-${i}`}>
            <div className="row">
              <strong>{amount(p.amount, p.currency)}</strong>
              <span className="muted small">{p.bank} · {dateOf(p.date)} {timeOf(p.date)}</span>
            </div>
            <div className="muted small clamp">{p.text}</div>
          </li>
        ))}
      </ul>
      {items.length < count && <button className="btn wide" disabled={busy} onClick={() => load(items.length, q)}>{busy ? '…' : `បង្ហាញបន្ថែម (${count - items.length})`}</button>}
    </section>
  );
}
