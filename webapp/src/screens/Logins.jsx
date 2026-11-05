// 🔑 Lottery logins (super admins, in ⚙️ Settings). Each login has its API
// URL (the base; the bot's routes are fixed), username, password, Basic
// value, extra headers, whether to fetch 📤 សាង, and its own run times. A run
// saves everyone's by-draw report, each followed member's, and every member's
// totals. Groups then pick a login and one member under it (📥 ឆ្នោត tab).

import { useEffect, useState } from 'react';
import { call } from '../api.js';

const KH_DIGITS = '០១២៣៤៥៦៧៨៩';
export const kh = (n) => String(n).replace(/\d/g, (d) => KH_DIGITS[d]);
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const STEPS = [1, 2, 3, 4, 6, 12];
const FIELD_ERRORS = {
  baseUrl: 'សូមដាក់ API URL ត្រឹមត្រូវ (https://…/api/v1.0.0)',
  username: 'សូមដាក់ Username',
  password: 'សូមដាក់ Password',
  basicAuth: 'Basic auth មិនត្រឹមត្រូវ',
  headers: 'Header ត្រូវតែជា «Name: value» មួយបន្ទាត់ម្ដង',
  times: 'សូមជ្រើសម៉ោងយ៉ាងហោចណាស់មួយ',
};
const NEW = { enabled: true, baseUrl: '', username: '', password: '', basicAuth: '', headers: 'platformtype: p99l', sendReport: true, times: ['21:00'] };

/** Every `step` hours on the hour, from `from` to `to` (inclusive). */
function every(step, from, to) {
  const out = [];
  for (let h = from; h <= to; h += step) out.push(hh(h));
  return out;
}

/** Which way of picking times a saved list looks like, so the right tab opens. */
function modeOf(times) {
  if (times.length <= 1) return { mode: 'once' };
  const hours = times.map((t) => (t.endsWith(':00') ? Number(t.slice(0, 2)) : NaN));
  const step = hours[1] - hours[0];
  if (STEPS.includes(step) && hours.every((h, i) => h === hours[0] + i * step)) {
    return { mode: 'every', span: { step, from: hours[0], to: hours.at(-1) } };
  }
  return { mode: 'custom' };
}

/** The next time it will run, from Phnom Penh's clock now. */
function nextRun(times) {
  if (!times.length) return null;
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const now = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const later = times.find((t) => t > now);
  return later ? `ថ្ងៃនេះ ${later}` : `ស្អែក ${times[0]}`;
}

const host = (url) => { try { return new URL(url).host; } catch { return url; } };

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** Once a day / every N hours between two hours / hand-picked: the run times. */
function TimesPicker({ times, onChange }) {
  const start = modeOf(times);
  const [mode, setMode] = useState(start.mode);
  const [span, setSpan] = useState(start.span ?? { step: 1, from: 8, to: 20 });
  const [newTime, setNewTime] = useState('12:00');
  const pickMode = (m) => {
    setMode(m);
    if (m === 'once') onChange([times[0] ?? '21:00']);
    if (m === 'every') onChange(every(span.step, span.from, span.to));
  };
  const changeSpan = (patch) => {
    const next = { ...span, ...patch };
    if (next.from > next.to) next.to = next.from;
    setSpan(next);
    onChange(every(next.step, next.from, next.to));
  };
  return (
    <>
      <div className="segmented small">
        <button className={mode === 'once' ? 'on' : ''} onClick={() => pickMode('once')}>ម្ដង/ថ្ងៃ</button>
        <button className={mode === 'every' ? 'on' : ''} onClick={() => pickMode('every')}>រៀងរាល់…ម៉ោង</button>
        <button className={mode === 'custom' ? 'on' : ''} onClick={() => pickMode('custom')}>ជ្រើសខ្លួនឯង</button>
      </div>
      {mode === 'once' && (
        <input className="field big" type="time" value={times[0] ?? ''} onChange={(e) => e.target.value && onChange([e.target.value])} />
      )}
      {mode === 'every' && (
        <>
          <div className="chips">
            {STEPS.map((n) => (
              <button key={n} className={span.step === n ? 'chip on' : 'chip'} onClick={() => changeSpan({ step: n })}>{kh(n)} ម៉ោង</button>
            ))}
          </div>
          <div className="row">
            <span className="muted small">ពី</span>
            <select className="field" value={span.from} onChange={(e) => changeSpan({ from: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
            <span className="muted small">ដល់</span>
            <select className="field" value={span.to} onChange={(e) => changeSpan({ to: Number(e.target.value) })}>
              {HOURS.filter((h) => h >= span.from).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </div>
        </>
      )}
      {mode === 'custom' && (
        <div className="row">
          <input className="field grow" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          <button className="btn small" disabled={!newTime || times.includes(newTime) || times.length >= 24} onClick={() => onChange([...times, newTime].sort())}>➕ បន្ថែម</button>
        </div>
      )}
      {mode !== 'once' && (
        <>
          <div className="muted small">{times.length ? `${kh(times.length)} ដង/ថ្ងៃ${mode === 'custom' ? ' · ចុចលើម៉ោងដើម្បីលុប' : ''}` : 'មិនទាន់មានម៉ោង'}</div>
          <div className="chips">
            {times.map((t) => (mode === 'custom'
              ? <button key={t} className="chip" onClick={() => onChange(times.filter((x) => x !== t))}>{t} ✕</button>
              : <span key={t} className="chip static">{t}</span>))}
          </div>
        </>
      )}
    </>
  );
}

/** Add or edit one login. */
function LoginForm({ login, onSaved, onCancel, onDeleted }) {
  const [form, setForm] = useState(() => ({ ...NEW, ...login, password: '' }));
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const set = (patch) => { setForm({ ...form, ...patch }); setError(null); };
  const save = () => {
    setBusy('save');
    call('loginSave', { id: login?.id, login: form })
      .then((r) => onSaved(r.logins, r.id))
      .catch((e) => setError(FIELD_ERRORS[e.parameters?.field] ?? e.message))
      .finally(() => setBusy(null));
  };
  const remove = () => {
    if (!window.confirm(`លុប Login ${login.username}? ក្រុមដែលប្រើវានឹងត្រូវបិទ។`)) return;
    setBusy('delete');
    call('loginDelete', { id: login.id }).then((r) => onDeleted(r.logins), (e) => setError(e.message)).finally(() => setBusy(null));
  };
  return (
    <div className="login-form">
      <label className="label">
        <span className="muted small">API URL (ឧ. https://…/api/v1.0.0) · Login និង Report ប្រើផ្លូវថេរ</span>
        <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="https://example.com/api/v1.0.0" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
      </label>
      <label className="label">
        <span className="muted small">Username</span>
        <input className="field" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
          value={form.username} onChange={(e) => set({ username: e.target.value })} />
      </label>
      <label className="label">
        <span className="muted small">Password {login?.hasPassword && <span className="ok">· បានរក្សាទុក ✓</span>}</span>
        <div className="row">
          <input className="field grow" type={showPw ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder={login?.hasPassword ? 'ទុកទទេ ដើម្បីប្រើដដែល' : ''} value={form.password} onChange={(e) => set({ password: e.target.value })} />
          <button type="button" className="icon" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? '🙈' : '👁'}</button>
        </div>
      </label>
      <label className="label">
        <span className="muted small">Basic auth លើ Login (ស្រេចចិត្ត · តម្លៃដែលបានបង្កើត)</span>
        <input className="field mono" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="Basic dXNlcjpwYXNz…" value={form.basicAuth} onChange={(e) => set({ basicAuth: e.target.value })} />
      </label>
      <label className="label">
        <span className="muted small">Header បន្ថែម · មួយបន្ទាត់ម្ដង «Name: value»</span>
        <textarea className="field mono" rows={2} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="platformtype: p99l" value={form.headers} onChange={(e) => set({ headers: e.target.value })} />
      </label>
      <div className="row">
        <div className="grow">
          <div className="small">📤 ទាញ សាង ផងដែរ</div>
          <div className="muted small">isSend=true · បង្ហាញខាងក្រោមរបាយការណ៍</div>
        </div>
        <Switch on={form.sendReport} onChange={(sendReport) => set({ sendReport })} label="សាង" />
      </div>
      <div className="small">⏰ ទាញតាមម៉ោង <span className="muted">(ម៉ោងភ្នំពេញ)</span></div>
      <TimesPicker times={form.times} onChange={(times) => set({ times })} />
      <div className="row">
        <div className="grow">
          <div className="small">ដំណើរការតាមម៉ោង</div>
          <div className="muted small">{form.enabled ? 'បើក' : 'ផ្អាក (ទិន្នន័យទាញតែពេលមានអ្នកមើល)'}</div>
        </div>
        <Switch on={form.enabled} onChange={(enabled) => set({ enabled })} label="Schedule" />
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="row">
        {login && <button className="icon" disabled={!!busy} onClick={remove}>{busy === 'delete' ? '…' : '🗑 លុប'}</button>}
        <button className="icon" disabled={!!busy} onClick={onCancel}>បោះបង់</button>
        <button className="btn grow" disabled={!!busy} onClick={save}>{busy === 'save' ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
      </div>
    </div>
  );
}

export default function Logins() {
  const [logins, setLogins] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [busy, setBusy] = useState(null); // `${action} ${id}`
  const [notes, setNotes] = useState({}); // id → text
  const [error, setError] = useState(null);
  useEffect(() => { call('logins').then((r) => setLogins(r.logins), setError); }, []);

  const note = (id, text) => setNotes((n) => ({ ...n, [id]: text }));
  const sync = (l) => {
    setBusy(`sync ${l.id}`);
    call('loginSync', { id: l.id })
      .then((r) => { setLogins(r.logins); note(l.id, '✅ Login ជោគជ័យ · បានទាញបញ្ជីថ្មី'); })
      .catch((e) => note(l.id, `⚠️ ${e.message}`))
      .finally(() => setBusy(null));
  };
  const run = (l) => {
    setBusy(`run ${l.id}`);
    call('loginRun', { id: l.id })
      .then((r) => note(l.id, [...r.reports.map((x) => `${x.ok ? '✅' : '⚠️'} ${x.who}${x.ok ? '' : ` — ${x.error}`}`), r.totalsError ? `⚠️ សរុប — ${r.totalsError}` : '✅ សរុបសមាជិក'].join('\n')))
      .catch((e) => note(l.id, `⚠️ ${e.message}`))
      .finally(() => setBusy(null));
  };

  if (!logins) return <section className="card"><strong>🔑 Login ឆ្នោត</strong><p className="muted small">{error ? error.message : 'កំពុងផ្ទុក…'}</p></section>;
  return (
    <section className="card">
      <strong>🔑 Login ឆ្នោត</strong>
      <p className="muted small">Login នីមួយៗទាញទិន្នន័យតាមម៉ោងរបស់វា៖ របាយការណ៍ទាំងអស់ សមាជិកដែលក្រុមតាមដាន និងសរុបសមាជិកទាំងអស់។ ក្រុមជ្រើសតែសមាជិក (📥 ឆ្នោត)។</p>
      {logins.map((l) => (editing === l.id ? (
        <LoginForm key={l.id} login={l} onCancel={() => setEditing(null)}
          onSaved={(list) => { setLogins(list); setEditing(null); note(l.id, '✅ បានរក្សាទុក'); }}
          onDeleted={(list) => { setLogins(list); setEditing(null); }} />
      ) : (
        <div key={l.id} className="login-item">
          <div className="row">
            <div className="grow">
              <div><strong>🔑 {l.username}</strong> <span className="muted small">· {host(l.baseUrl)}</span></div>
              <div className={`small ${l.enabled ? 'ok' : 'muted'}`}>
                {l.enabled ? `✅ ${kh(l.times.length)} ដង/ថ្ងៃ · បន្ទាប់: ${nextRun(l.times)}` : '⏸ ផ្អាក'}{l.sendReport ? ' · 📤 សាង' : ''}
              </div>
              <div className="muted small">
                🧑‍💼 {kh(l.people.length)} · 👤 {kh(l.people.reduce((n, a) => n + a.members.length, 0))} · 🏪 {kh(l.groups)} ក្រុម
              </div>
            </div>
            <button className="icon" onClick={() => setEditing(l.id)}>✏️</button>
          </div>
          <div className="row">
            <button className="icon grow small" disabled={!!busy} onClick={() => sync(l)}>{busy === `sync ${l.id}` ? 'កំពុងទាញ…' : '🔄 ពិនិត្យ Login + បញ្ជី'}</button>
            <button className="icon grow small" disabled={!!busy} onClick={() => run(l)}>{busy === `run ${l.id}` ? 'កំពុងទាញ…' : '▶️ ទាញឥឡូវ'}</button>
          </div>
          {notes[l.id] && <pre className="note small">{notes[l.id]}</pre>}
        </div>
      )))}
      {editing === 'new' ? (
        <LoginForm onCancel={() => setEditing(null)} onSaved={(list) => { setLogins(list); setEditing(null); }} onDeleted={() => {}} />
      ) : (
        <button className="btn small" onClick={() => setEditing('new')}>➕ បន្ថែម Login</button>
      )}
    </section>
  );
}
