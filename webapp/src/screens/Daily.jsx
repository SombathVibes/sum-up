// A group's Daily report (super admins), in three steps: the URL to call (and
// a sign-in, if the API needs one), when
// to call it (once a day, every few hours, or hand-picked times, Phnom Penh),
// and whether to post the result in the group. Then a test run and the recent
// reports the bot saved (one per time).

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { timeOf } from '../format.js';

const STEPS = [1, 2, 3, 4, 6, 12];
const FIELD_ERRORS = {
  url: 'សូមដាក់ URL ត្រឹមត្រូវ (https://…)',
  url2: 'URL ទី២ មិនត្រឹមត្រូវ (https://…)',
  member: 'សមាជិកមិនត្រឹមត្រូវ',
  times: 'សូមជ្រើសម៉ោងយ៉ាងហោចណាស់មួយ',
  loginUrl: 'សូមដាក់ Login URL ត្រឹមត្រូវ (https://…)',
  username: 'សូមដាក់ Username',
  password: 'សូមដាក់ Password',
  tokenField: 'ឈ្មោះ token field មិនត្រឹមត្រូវ',
  basicAuth: 'សូមដាក់ Basic auth (តម្លៃដែលបានបង្កើត)',
  headers: 'Header ត្រូវតែជា «Name: value» មួយបន្ទាត់ម្ដង',
};
const KH_DIGITS = '០១២៣៤៥៦៧៨៩';
const kh = (n) => String(n).replace(/\d/g, (d) => KH_DIGITS[d]);
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

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

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export default function DailyPanel({ group }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [mode, setMode] = useState('once');
  const [span, setSpan] = useState({ step: 1, from: 8, to: 20 });
  const [newTime, setNewTime] = useState('12:00');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [openKey, setOpenKey] = useState(null); // `${day} ${slot}`
  const [showPw, setShowPw] = useState(false);
  const [members, setMembers] = useState(null); // [{ agentCode, agent, members: [{ username, userCode, nickname }] }]
  const [membersError, setMembersError] = useState(null);
  const loadMembers = () => {
    setMembersError(null);
    setMembers('loading');
    call('dailyMembers', { groupId: group.tgId }).then((r) => setMembers(r.agents), (e) => { setMembers(null); setMembersError(e.message); });
  };

  // The password is write-only: the form starts empty and the server only says hasPassword.
  const fill = (config) => {
    setForm({ ...config, password: '', useBasic: config.hasBasicAuth });
    const m = modeOf(config.times);
    setMode(m.mode);
    if (m.span) setSpan(m.span);
  };
  const load = () => call('dailyGet', { groupId: group.tgId }).then((r) => { setData(r); fill(r.config); }, setError);
  useEffect(() => { load(); }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!form) return <main className="content"><p className="center muted">កំពុងផ្ទុក…</p></main>;

  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); setError(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...data.config, password: '', useBasic: data.config.hasBasicAuth });
  const saved = data.config;

  const pickMode = (m) => {
    setMode(m);
    if (m === 'once') set({ times: [form.times[0] ?? '21:00'] });
    if (m === 'every') set({ times: every(span.step, span.from, span.to) });
  };
  const changeSpan = (patch) => {
    const next = { ...span, ...patch };
    if (next.from > next.to) next.to = next.from;
    setSpan(next);
    set({ times: every(next.step, next.from, next.to) });
  };
  const addTime = () => !form.times.includes(newTime) && set({ times: [...form.times, newTime].sort() });
  const insert = (token) => set({ url: form.url + token });

  const save = () => {
    setBusy('save');
    call('dailySave', { groupId: group.tgId, config: form })
      .then((r) => { setData({ ...data, config: r.config }); fill(r.config); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setError(FIELD_ERRORS[e.parameters?.field] ? new Error(FIELD_ERRORS[e.parameters.field]) : e))
      .finally(() => setBusy(null));
  };
  const run = (post) => {
    setBusy(post ? 'post' : 'test');
    setError(null);
    call('dailyRun', { groupId: group.tgId, post })
      .then((r) => {
        setNote(r.ok ? `✅ ជោគជ័យ (HTTP ${r.httpStatus})${post && saved.postToGroup ? ' · បានផ្ញើទៅក្រុម' : ''}` : `⚠️ ${r.error}`);
        setOpenKey(`${r.day} ${r.slot}`);
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(null));
  };

  const status = !saved.enabled ? '⏸ បិទ' : `✅ បើក · ${kh(saved.times.length)} ដង/ថ្ងៃ · បន្ទាប់: ${nextRun(saved.times)}`;

  return (
    <main className="content daily">
      <section className="card">
        <div className="row">
          <div className="grow">
            <strong>📥 របាយការណ៍ឆ្នោត</strong>
            <div className={`small ${saved.enabled ? 'ok' : 'muted'}`}>{status}</div>
          </div>
          <Switch on={form.enabled} onChange={(enabled) => set({ enabled })} label="របាយការណ៍ឆ្នោត" />
        </div>
      </section>

      <section className="card">
        <div className="step"><span>1</span> URL ដែលត្រូវហៅ</div>
        <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="https://example.com/report?date={date}" value={form.url} onChange={(e) => set({ url: e.target.value })} />
        <div className="chips">
          <button className="chip" onClick={() => insert('{date}')}>+ {'{date}'} <span className="muted">ថ្ងៃ</span></button>
          <button className="chip" onClick={() => insert('{group}')}>+ {'{group}'} <span className="muted">ID ក្រុម</span></button>
          <button className="chip" onClick={() => insert('{member}')}>+ {'{member}'} <span className="muted">អ្នកដែលកំពុងមើល</span></button>
        </div>

        <div className="label">
          <span className="muted small">👤 លំនាំដើម (ស្រេចចិត្ត) · ការហៅតាមម៉ោង និងពេលបើកដំបូង · មិនកំណត់ = 👥 ទាំងអស់។ ក្នុង bot អាចប្តូរមើលសមាជិក / ភ្នាក់ងារផ្សេងបាន 🔀</span>
          {Array.isArray(members) ? (
            <select className="field" value={form.memberCode}
              onChange={(e) => {
                const code = e.target.value;
                const hit = members.flatMap((a) => a.members.map((m) => ({ ...m, agentCode: a.agentCode }))).find((m) => m.userCode === code);
                set({ memberCode: code, memberName: hit?.username ?? '', agentCode: hit?.agentCode ?? '' });
              }}>
              <option value="">👥 ទាំងអស់ (មិនកំណត់)</option>
              {members.map((a) => (
                <optgroup key={a.agentCode} label={`${a.agent}${a.agentNick ? ` · ${a.agentNick}` : ''}`}>
                  {a.members.map((m) => <option key={m.userCode} value={m.userCode}>{m.username}{m.nickname ? ` · ${m.nickname}` : ''}</option>)}
                </optgroup>
              ))}
            </select>
          ) : (
            <div className="row">
              <span className="grow small">{form.memberCode ? `${form.memberName || form.memberCode}` : <span className="muted">👥 ទាំងអស់</span>}</span>
              <button type="button" className="btn small" disabled={members === 'loading' || form.authType !== 'login'} onClick={loadMembers}>
                {members === 'loading' ? 'កំពុងទាញ…' : form.memberCode ? '🔄 ប្តូរ' : '👤 ជ្រើសរើស'}
              </button>
            </div>
          )}
          {form.authType !== 'login' && <span className="muted small">ត្រូវបើក 🔐 Login ហើយរក្សាទុកជាមុន។</span>}
          {membersError && <span className="small error">⚠️ {membersError}</span>}
        </div>
        <label className="label">
          <span className="muted small">URL ទី២ (ស្រេចចិត្ត) · ហៅរាល់ពេលជាមួយ URL ទី១ ហើយរក្សាទុកទាំងពីរ</span>
          <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="https://example.com/report?date={date}&isSend=true" value={form.url2} onChange={(e) => set({ url2: e.target.value })} />
          {form.url && !form.url2 && (
            <button type="button" className="chip" onClick={() => set({ url2: `${form.url}${form.url.includes('?') ? '&' : '?'}isSend=true` })}>+ ចម្លង URL ទី១ + isSend=true</button>
          )}
        </label>

        <label className="label">
          <span className="muted small">Header បន្ថែម (Login និង URL) · មួយបន្ទាត់ម្ដង «Name: value»</span>
          <textarea className="field mono" rows={2} autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="X-Platform: web" value={form.headers} onChange={(e) => set({ headers: e.target.value })} />
        </label>
        <div className="row divided">
          <div className="grow">
            <div className="small">🔐 ត្រូវការ Login</div>
            <div className="muted small">{form.authType === 'login' ? 'Login មុន រួចហៅ URL ជាមួយ token' : 'API មិនត្រូវការ Login'}</div>
          </div>
          <Switch on={form.authType === 'login'} onChange={(on) => set({ authType: on ? 'login' : 'none' })} label="Login" />
        </div>
        {form.authType === 'login' && (
          <div className="login">
            <label className="label">
              <span className="muted small">Login URL (POST)</span>
              <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                placeholder="https://example.com/api/auth/login" value={form.loginUrl} onChange={(e) => set({ loginUrl: e.target.value })} />
            </label>
            <label className="label">
              <span className="muted small">Username</span>
              <input className="field" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
                value={form.username} onChange={(e) => set({ username: e.target.value })} />
            </label>
            <label className="label">
              <span className="muted small">Password {data.config.hasPassword && <span className="ok">· បានរក្សាទុក ✓</span>}</span>
              <div className="row">
                <input className="field grow" type={showPw ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder={data.config.hasPassword ? 'ទុកទទេ ដើម្បីប្រើដដែល' : ''} value={form.password} onChange={(e) => set({ password: e.target.value })} />
                <button type="button" className="icon" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? '🙈' : '👁'}</button>
              </div>
            </label>
            <div className="row">
              <div className="grow">
                <div className="small">Basic auth លើ Login</div>
                <div className="muted small">បិទភ្ជាប់តម្លៃ Basic ដែលបានបង្កើតរួច</div>
              </div>
              <Switch on={form.useBasic} onChange={(useBasic) => set({ useBasic, basicAuth: useBasic ? data.config.basicAuth : '' })} label="Basic auth" />
            </div>
            {form.useBasic && (
              <label className="label">
                <span className="muted small">Basic auth (តម្លៃដែលបានបង្កើត)</span>
                <input className="field mono" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder="Basic dXNlcjpwYXNz…" value={form.basicAuth} onChange={(e) => set({ basicAuth: e.target.value })} />
              </label>
            )}
            <details>
              <summary className="muted small">កម្រិតខ្ពស់</summary>
              <label className="label">
                <span className="muted small">Token field (ទុកទទេ = រកដោយស្វ័យប្រវត្តិ: token, access_token, data.token…)</span>
                <input className="field" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder="data.accessToken" value={form.tokenField} onChange={(e) => set({ tokenField: e.target.value })} />
              </label>
            </details>
          </div>
        )}
      </section>

      <section className="card">
        <div className="step"><span>2</span> ពេលណា <span className="muted small">(ម៉ោងភ្នំពេញ)</span></div>
        <div className="segmented small">
          <button className={mode === 'once' ? 'on' : ''} onClick={() => pickMode('once')}>ម្ដង/ថ្ងៃ</button>
          <button className={mode === 'every' ? 'on' : ''} onClick={() => pickMode('every')}>រៀងរាល់…ម៉ោង</button>
          <button className={mode === 'custom' ? 'on' : ''} onClick={() => pickMode('custom')}>ជ្រើសខ្លួនឯង</button>
        </div>

        {mode === 'once' && (
          <input className="field big" type="time" value={form.times[0] ?? ''} onChange={(e) => e.target.value && set({ times: [e.target.value] })} />
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
            <button className="btn small" disabled={!newTime || form.times.includes(newTime) || form.times.length >= 24} onClick={addTime}>➕ បន្ថែម</button>
          </div>
        )}

        {mode !== 'once' && (
          <>
            <div className="muted small">{form.times.length ? `${kh(form.times.length)} ដង/ថ្ងៃ${mode === 'custom' ? ' · ចុចលើម៉ោងដើម្បីលុប' : ''}` : 'មិនទាន់មានម៉ោង'}</div>
            <div className="chips">
              {form.times.map((t) => (mode === 'custom'
                ? <button key={t} className="chip" onClick={() => set({ times: form.times.filter((x) => x !== t) })}>{t} ✕</button>
                : <span key={t} className="chip static">{t}</span>))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="row">
          <div className="grow">
            <div className="step"><span>3</span> ផ្ញើទៅក្រុម</div>
            <div className="muted small">{form.postToGroup ? 'ផ្ញើលទ្ធផលទៅក្រុម ហើយរក្សាទុក' : 'រក្សាទុកតែប៉ុណ្ណោះ (មើលតាម 📥 ក្នុង /menu)'}</div>
          </div>
          <Switch on={form.postToGroup} onChange={(postToGroup) => set({ postToGroup })} label="Post to group" />
        </div>
      </section>

      {error && <p className="error">{error.message}</p>}
      {note && <p className="small">{note}</p>}

      {dirty ? (
        <div className="savebar">
          <button className="icon" disabled={!!busy} onClick={() => { fill(data.config); setNote(null); setError(null); }}>បោះបង់</button>
          <button className="btn grow" disabled={!!busy} onClick={save}>{busy === 'save' ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
        </div>
      ) : (
        <div className="row">
          <button className="icon grow" disabled={!!busy || !saved.url} onClick={() => run(false)}>{busy === 'test' ? 'កំពុងហៅ…' : '🧪 សាកល្បង'}</button>
          <button className="icon grow" disabled={!!busy || !saved.url} onClick={() => run(true)}>{busy === 'post' ? 'កំពុងហៅ…' : '▶️ ដំណើរការឥឡូវ'}</button>
        </div>
      )}
      {!dirty && !saved.url && <p className="muted small center-text">ដាក់ URL ហើយរក្សាទុក ដើម្បីសាកល្បង។</p>}

      <section className="card">
        <strong>🧾 លទ្ធផលថ្មីៗ</strong>
        {!data.reports.length && <p className="muted small">មិនទាន់មានទេ។ ចុច 🧪 សាកល្បង ដើម្បីមើលអ្វីដែល URL ផ្ញើមក។</p>}
        <ul className="payments">
          {data.reports.map((r) => {
            const key = `${r.day} ${r.subject}`;
            return (
              <li key={key}>
                <button className="row plain" onClick={() => setOpenKey(openKey === key ? null : key)}>
                  <span>{r.ok ? '✅' : '⚠️'} {r.day.split('-').reverse().join('/')} · {r.slot} · {r.subject ? (r.subject === form.memberCode ? `👤 ${form.memberName || r.subject}` : `👤 ${r.subject}`) : '👥'}</span>
                  <span className="muted small">{r.ok ? `HTTP ${r.httpStatus}` : r.error} {openKey === key ? '▴' : '▾'}</span>
                </button>
                {openKey === key && (
                  <>
                    <pre className="body">{r.body || '—'}</pre>
                    {(r.body2 || r.error2) && (
                      <>
                        <div className="muted small">URL ទី២{r.error2 ? ` · ⚠️ ${r.error2}` : ''}</div>
                        {r.body2 && <pre className="body">{r.body2}</pre>}
                      </>
                    )}
                    <div className="muted small">ហៅនៅ {timeOf(r.ranAt)}</div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
