// A group's lottery report (super admins), in four steps that fold: the API
// and login (the base URL; the routes are fixed in the bot) and whether to
// fetch 📤 សាង too, whose report is the default (everyone under the login, or
// one member; the agents and members found under the login are listed), when
// to call it (once a day, every few hours, or hand-picked times, Phnom Penh),
// and whether to post the result in the group. Then a test run for anyone,
// and the recent reports the bot saved (one per day and person).

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { timeOf } from '../format.js';

const STEPS = [1, 2, 3, 4, 6, 12];
const FIELD_ERRORS = {
  baseUrl: 'សូមដាក់ API URL ត្រឹមត្រូវ (https://…/api/v1.0.0)',
  member: 'សមាជិកមិនត្រឹមត្រូវ',
  times: 'សូមជ្រើសម៉ោងយ៉ាងហោចណាស់មួយ',
  username: 'សូមដាក់ Username',
  password: 'សូមដាក់ Password',
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

/**
 * A setup step that folds: the header shows its number, title and a one-line
 * summary of what's set; it starts open when that part isn't set up yet.
 */
function Step({ n, title, summary, warn = false, start = false, children }) {
  const [open, setOpen] = useState(start);
  return (
    <details className="card fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <div className="step"><span>{n}</span> {title}</div>
        <div className={`small ${warn ? 'warn-text' : 'muted'}`}>{summary}</div>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
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
  const [openKey, setOpenKey] = useState(null); // `${day} ${subject}`
  const [showPw, setShowPw] = useState(false);
  const [people, setPeople] = useState([]); // [{ agentCode, agent, agentNick, members: [{ username, userCode, nickname }] }]
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState(null);
  const [testWho, setTestWho] = useState('default'); // 'default' | '' (everyone) | a user code
  const loadPeople = () => {
    setPeopleError(null);
    setPeopleBusy(true);
    call('dailyMembers', { groupId: group.tgId })
      .then((r) => setPeople(r.agents), (e) => setPeopleError(e.message))
      .finally(() => setPeopleBusy(false));
  };

  // The password is write-only: the form starts empty and the server only says hasPassword.
  const fill = (config) => {
    setForm({ ...config, password: '', useBasic: config.hasBasicAuth });
    const m = modeOf(config.times);
    setMode(m.mode);
    if (m.span) setSpan(m.span);
  };
  const load = () => call('dailyGet', { groupId: group.tgId }).then((r) => { setData(r); setPeople(r.people ?? []); fill(r.config); }, setError);
  useEffect(() => { load(); }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!form) return <main className="content"><p className="center muted">កំពុងផ្ទុក…</p></main>;

  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); setError(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...data.config, password: '', useBasic: data.config.hasBasicAuth });
  const saved = data.config;
  const memberCount = people.reduce((n, a) => n + a.members.length, 0);
  const savedLogin = !!saved.baseUrl;

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
  const pickDefault = (code) => {
    const hit = people.flatMap((a) => a.members.map((m) => ({ ...m, agentCode: a.agentCode }))).find((m) => m.userCode === code);
    set({ memberCode: code, memberName: hit?.username ?? '', agentCode: hit?.agentCode ?? '' });
  };

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
    call('dailyRun', { groupId: group.tgId, post, ...(testWho !== 'default' && { subject: testWho }) })
      .then((r) => {
        setNote(r.ok ? `✅ ជោគជ័យ (HTTP ${r.httpStatus})${post && saved.postToGroup ? ' · បានផ្ញើទៅក្រុម' : ''}` : `⚠️ ${r.error}`);
        setOpenKey(`${r.day} ${r.subject}`);
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(null));
  };

  const status = !saved.enabled ? '⏸ បិទ' : `✅ បើក · ${kh(saved.times.length)} ដង/ថ្ងៃ · បន្ទាប់: ${nextRun(saved.times)}`;
  const host = (() => { try { return new URL(form.baseUrl).host; } catch { return ''; } })();
  const sumLogin = !form.baseUrl ? 'មិនទាន់មាន API URL' : `${host} · 🔐 ${form.username || '—'}${form.useBasic ? ' · Basic' : ''}${form.headers ? ` · ${kh(form.headers.split('\n').length)} header` : ''}${form.sendReport ? ' · 📤 សាង' : ''}`;
  const sumWho = `⭐ ${form.memberCode ? form.memberName || form.memberCode : '👥 ទាំងអស់'}${people.length ? ` · 🧑‍💼 ${kh(people.length)} · 👤 ${kh(memberCount)}` : ''}`;
  const sumWhen = form.times.length ? `${kh(form.times.length)} ដង/ថ្ងៃ · ${form.times.length > 1 ? `${form.times[0]}–${form.times.at(-1)}` : form.times[0]}` : 'មិនទាន់មានម៉ោង';
  const memberLabel = (m) => `${m.username}${m.nickname ? ` · ${m.nickname}` : ''}`;
  const agentLabel = (a) => `${a.agent}${a.agentNick ? ` · ${a.agentNick}` : ''}`;

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

      <Step n={1} title="🔗 API និង Login" summary={sumLogin} start={!saved.baseUrl}>
        <label className="label">
          <span className="muted small">API URL (ឧ. https://…/api/v1.0.0) · Login និង Report ប្រើផ្លូវថេរ</span>
          <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="https://example.com/api/v1.0.0" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
        </label>
        <div className="login">
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
        </div>
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
      </Step>

      <Step n={2} title="អ្នកណា" summary={sumWho} start={savedLogin && !people.length}>
        <div className="row">
          <div className="grow muted small">
            {people.length ? `🧑‍💼 ${kh(people.length)} ភ្នាក់ងារ · 👤 ${kh(memberCount)} សមាជិក នៅក្រោម Login` : 'មិនទាន់មានបញ្ជី — ចុច 🔄'}
          </div>
          <button type="button" className="btn small" disabled={peopleBusy || !savedLogin} onClick={loadPeople}>{peopleBusy ? 'កំពុងទាញ…' : '🔄 ទាញបញ្ជី'}</button>
        </div>
        {!savedLogin && <span className="muted small">រក្សាទុក 🔐 Login ជាមុនសិន។</span>}
        {peopleError && <span className="small error">⚠️ {peopleError}</span>}
        {people.length > 0 && (
          <details>
            <summary className="muted small">មើលបញ្ជី</summary>
            <ul className="people small">
              {people.map((a) => (
                <li key={a.agentCode}>
                  🧑‍💼 <strong>{agentLabel(a)}</strong>
                  <div className="muted">{a.members.length ? a.members.map((m) => `👤 ${memberLabel(m)}`).join(' · ') : 'គ្មានសមាជិក'}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
        <label className="label">
          <span className="muted small">⭐ លំនាំដើម · ការហៅតាមម៉ោង និងពេលបើកក្នុង bot (ក្នុង bot ចុច 🔀 ដើម្បីមើលអ្នកផ្សេង)</span>
          <select className="field" value={form.memberCode} onChange={(e) => pickDefault(e.target.value)}>
            <option value="">👥 ទាំងអស់</option>
            {form.memberCode && !people.some((a) => a.members.some((m) => m.userCode === form.memberCode)) && (
              <option value={form.memberCode}>👤 {form.memberName || form.memberCode}</option>
            )}
            {people.map((a) => (
              <optgroup key={a.agentCode} label={`🧑‍💼 ${agentLabel(a)}`}>
                {a.members.map((m) => <option key={m.userCode} value={m.userCode}>👤 {memberLabel(m)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </Step>

      <Step n={3} title={<>ពេលណា <span className="muted small">(ម៉ោងភ្នំពេញ)</span></>} summary={sumWhen} start={!saved.baseUrl}>
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
      </Step>

      <Step n={4} title="ផ្ញើទៅក្រុម" summary={form.postToGroup ? '✅ ផ្ញើទៅក្រុម' : '⏸ រក្សាទុកតែប៉ុណ្ណោះ'} start={!saved.baseUrl}>
        <div className="row">
          <div className="grow muted small">{form.postToGroup ? 'ផ្ញើលទ្ធផលរបស់ ⭐ លំនាំដើម ទៅក្រុម ហើយរក្សាទុក' : 'រក្សាទុកតែប៉ុណ្ណោះ (មើលតាម 📥 ក្នុង /menu)'}</div>
          <Switch on={form.postToGroup} onChange={(postToGroup) => set({ postToGroup })} label="Post to group" />
        </div>
      </Step>

      {error && <p className="error">{error.message}</p>}
      {note && <p className="small">{note}</p>}

      {dirty ? (
        <div className="savebar">
          <button className="icon" disabled={!!busy} onClick={() => { fill(data.config); setNote(null); setError(null); }}>បោះបង់</button>
          <button className="btn grow" disabled={!!busy} onClick={save}>{busy === 'save' ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
        </div>
      ) : (
        <>
          <label className="label">
            <span className="muted small">សាកល្បងសម្រាប់</span>
            <select className="field" value={testWho} onChange={(e) => setTestWho(e.target.value)}>
              <option value="default">⭐ លំនាំដើម ({saved.memberCode ? saved.memberName || saved.memberCode : 'ទាំងអស់'})</option>
              <option value="">👥 ទាំងអស់</option>
              {people.length > 1 && people.map((a) => <option key={a.agentCode} value={a.agentCode}>🧑‍💼 {agentLabel(a)}</option>)}
              {people.map((a) => a.members.map((m) => <option key={m.userCode} value={m.userCode}>👤 {memberLabel(m)}</option>))}
            </select>
          </label>
          <div className="row">
            <button className="icon grow" disabled={!!busy || !saved.baseUrl} onClick={() => run(false)}>{busy === 'test' ? 'កំពុងហៅ…' : '🧪 សាកល្បង'}</button>
            <button className="icon grow" disabled={!!busy || !saved.baseUrl} onClick={() => run(true)}>{busy === 'post' ? 'កំពុងហៅ…' : '▶️ ដំណើរការឥឡូវ'}</button>
          </div>
        </>
      )}
      {!dirty && !saved.baseUrl && <p className="muted small center-text">ដាក់ API URL និង Login ហើយរក្សាទុក ដើម្បីសាកល្បង។</p>}

      <section className="card">
        <strong>🧾 លទ្ធផលថ្មីៗ</strong>
        {!data.reports.length && <p className="muted small">មិនទាន់មានទេ។ ចុច 🧪 សាកល្បង ដើម្បីមើលអ្វីដែល API ផ្ញើមក។</p>}
        <ul className="payments">
          {data.reports.map((r) => {
            const key = `${r.day} ${r.subject}`;
            return (
              <li key={key}>
                <button className="row plain" onClick={() => setOpenKey(openKey === key ? null : key)}>
                  <span>{r.ok ? '✅' : '⚠️'} {r.day.split('-').reverse().join('/')} · {r.slot} · {r.who}</span>
                  <span className="muted small">{r.ok ? `HTTP ${r.httpStatus}` : r.error} {openKey === key ? '▴' : '▾'}</span>
                </button>
                {openKey === key && (
                  <>
                    <pre className="body">{r.body || '—'}</pre>
                    {(r.body2 || r.error2) && (
                      <>
                        <div className="muted small">📤 សាង{r.error2 ? ` · ⚠️ ${r.error2}` : ''}</div>
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
