// A group's Daily report (super admins): switch it on, the URL to call and the
// time (Phnom Penh), whether to post it in the group, a test run, and the
// recent reports the bot saved.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { dateOf, timeOf } from '../format.js';

export default function DailyPanel({ group }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [openDay, setOpenDay] = useState(null);

  const load = () => call('dailyGet', { groupId: group.tgId }).then((r) => { setData(r); setForm(r.config); }, setError);
  useEffect(() => { load(); }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!form) return <main className="content"><p className="center muted">កំពុងផ្ទុក…</p></main>;

  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);
  const fieldError = (e) => (e.parameters?.field === 'url' ? new Error('សូមពិនិត្យ URL (https://…)') : e.parameters?.field === 'time' ? new Error('សូមពិនិត្យម៉ោង') : e);

  const save = () => {
    setBusy('save');
    setError(null);
    call('dailySave', { groupId: group.tgId, config: form })
      .then((r) => { setData({ ...data, config: r.config }); setForm(r.config); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setError(fieldError(e)))
      .finally(() => setBusy(null));
  };
  const run = (post) => {
    setBusy(post ? 'post' : 'test');
    setError(null);
    call('dailyRun', { groupId: group.tgId, post })
      .then((r) => { setNote(r.ok ? `✅ HTTP ${r.httpStatus}${post && form.postToGroup ? ' · បានផ្ញើទៅក្រុម' : ''}` : `⚠️ ${r.error}`); setOpenDay(r.day); return load(); })
      .catch(setError)
      .finally(() => setBusy(null));
  };

  return (
    <main className="content">
      <section className="card">
        <div className="row">
          <strong>📥 Daily report</strong>
          <button className={`btn small${form.enabled ? '' : ' off'}`} onClick={() => set({ enabled: !form.enabled })}>{form.enabled ? 'ON' : 'OFF'}</button>
        </div>
        <p className="muted small">បិទជាលំនាំដើម។ ពេលបើក bot ហៅ URL នេះរៀងរាល់ថ្ងៃតាមម៉ោងកំណត់ រក្សាទុកលទ្ធផល ហើយបង្ហាញប៊ូតុង 📥 ក្នុង /menu។</p>
        <label className="label">
          <span className="muted small">🔗 URL · {'{date}'} = ថ្ងៃ (YYYY-MM-DD) · {'{group}'} = ID ក្រុម</span>
          <input className="field" inputMode="url" placeholder="https://example.com/report?date={date}" value={form.url} onChange={(e) => set({ url: e.target.value })} />
        </label>
        <label className="label">
          <span className="muted small">🕘 ម៉ោង (ភ្នំពេញ)</span>
          <input className="field" type="time" value={form.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
        </label>
        <div className="row">
          <span className="small">💬 ផ្ញើទៅក្រុម</span>
          <button className={`btn small${form.postToGroup ? '' : ' off'}`} onClick={() => set({ postToGroup: !form.postToGroup })}>{form.postToGroup ? 'ON' : 'OFF'}</button>
        </div>
      </section>

      {error && <p className="error">{error.message}</p>}
      {note && <p className="small">{note}</p>}
      <button className="btn wide" disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
      <div className="row">
        <button className="icon grow" disabled={!!busy || dirty || !data.config.url} onClick={() => run(false)}>{busy === 'test' ? '…' : '🧪 សាកល្បង (មិនផ្ញើ)'}</button>
        <button className="icon grow" disabled={!!busy || dirty || !data.config.url} onClick={() => run(true)}>{busy === 'post' ? '…' : '▶️ ដំណើរការឥឡូវ'}</button>
      </div>
      {dirty && <p className="muted small">រក្សាទុកមុន ទើបអាចសាកល្បងបាន។</p>}

      <section className="card">
        <strong>🧾 របាយការណ៍ថ្មីៗ</strong>
        {!data.reports.length && <p className="muted">មិនទាន់មានទេ។</p>}
        <ul className="payments">
          {data.reports.map((r) => (
            <li key={r.day}>
              <button className="row plain" onClick={() => setOpenDay(openDay === r.day ? null : r.day)}>
                <span>{r.ok ? '✅' : '⚠️'} {r.day.split('-').reverse().join('/')}</span>
                <span className="muted small">{r.ok ? `HTTP ${r.httpStatus}` : r.error} · {timeOf(r.ranAt)}</span>
              </button>
              {openDay === r.day && <pre className="body">{r.body || '—'}</pre>}
            </li>
          ))}
        </ul>
        {data.reports.length > 0 && <p className="muted small">ចុងក្រោយ: {dateOf(data.reports[0].ranAt)} {timeOf(data.reports[0].ranAt)}</p>}
      </section>
    </main>
  );
}
