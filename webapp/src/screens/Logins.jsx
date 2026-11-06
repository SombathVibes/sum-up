// 🔑 Lottery logins (super admins, in ⚙️ Settings). Each login has its API
// URL (the base; the bot's routes are fixed), username, password, Basic
// value, extra headers, whether to fetch 📤 សាង, and its own run times. A run
// saves everyone's by-draw report, each followed member's, and every member's
// totals. Groups then pick a login and one member under it (📥 ឆ្នោត tab).

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import Fold from './Fold.jsx';
import { SkeletonCard } from '../components/Skeleton.jsx';

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

const apiOf = (p) => ({ baseUrl: p?.baseUrl ?? '', basicAuth: p?.basicAuth ?? '', headers: p?.headers ?? NEW.headers });

/** Add or edit one login: 🌐 a platform, username and password; the rest under ⚙️. */
function LoginForm({ login, platforms = [], onSaved, onCancel, onDeleted }) {
  const [form, setForm] = useState(() => ({ ...NEW, ...(login ? {} : apiOf(platforms[0])), ...login, password: '' }));
  const [showPw, setShowPw] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const set = (patch) => { setForm({ ...form, ...patch }); setError(null); };
  const save = () => {
    setBusy('save');
    call('loginSave', { id: login?.id, login: form })
      .then((r) => onSaved(r.logins, r.id, r.check))
      .catch((e) => { setError(FIELD_ERRORS[e.parameters?.field] ?? e.message); if (['baseUrl', 'basicAuth', 'headers', 'times'].includes(e.parameters?.field)) setMore(true); })
      .finally(() => setBusy(null));
  };
  const remove = () => {
    if (!window.confirm(`លុប Login ${login.username}? ក្រុមដែលប្រើវានឹងត្រូវបិទ។`)) return;
    setBusy('delete');
    call('loginDelete', { id: login.id }).then((r) => onDeleted(r.logins), (e) => setError(e.message)).finally(() => setBusy(null));
  };
  const platform = platforms.find((p) => p.baseUrl === form.baseUrl && (p.basicAuth ?? '') === (form.basicAuth ?? ''));
  const summary = [`⏰ ${form.times.length === 1 ? form.times[0] : `${kh(form.times.length)} ដង/ថ្ងៃ`}`, form.sendReport ? '📤 សាង' : null, form.enabled ? null : '⏸ ផ្អាក', platform ? null : host(form.baseUrl) || '⚠️ គ្មាន API URL'].filter(Boolean).join(' · ');
  return (
    <div className="login-form">
      {platforms.length > 0 && (
        <div className="label">
          <span className="muted small">🌐 Platform</span>
          <div className="chips">
            {platforms.map((p) => (
              <button key={`${p.name}${p.baseUrl}`} type="button" className={platform === p ? 'chip on' : 'chip'} onClick={() => set(apiOf(p))}>{p.name}</button>
            ))}
            {!platform && <span className="chip on static">✏️ {host(form.baseUrl) || 'ផ្សេង'}</span>}
          </div>
        </div>
      )}
      <label className="label">
        <span className="muted small">Username</span>
        <input className="field roomy" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
          value={form.username} onChange={(e) => set({ username: e.target.value })} />
      </label>
      <label className="label">
        <span className="muted small">Password {login?.hasPassword && <span className="ok">· បានរក្សាទុក ✓</span>}</span>
        <div className="row">
          <input className="field roomy grow" type={showPw ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder={login?.hasPassword ? 'ទុកទទេ ដើម្បីប្រើដដែល' : ''} value={form.password} onChange={(e) => set({ password: e.target.value })} />
          <button type="button" className="icon" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? '🙈' : '👁'}</button>
        </div>
      </label>

      <button type="button" className="more" onClick={() => setMore(!more)}>
        <span>⚙️ កម្រិតខ្ពស់</span><span className="muted small grow">{summary}</span><span>{more ? '▴' : '▾'}</span>
      </button>
      {more && (
        <div className="advanced">
          <label className="label">
            <span className="muted small">API URL (ឧ. https://…/api/v1.0.0)</span>
            <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="https://example.com/api/v1.0.0" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
          </label>
          <label className="label">
            <span className="muted small">Basic auth លើ Login (ស្រេចចិត្ត)</span>
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
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="row">
        {login && <button className="icon" disabled={!!busy} onClick={remove}>{busy === 'delete' ? '…' : '🗑 លុប'}</button>}
        <button className="icon" disabled={!!busy} onClick={onCancel}>បោះបង់</button>
        <button className="btn grow" disabled={!!busy || !form.username.trim() || (!login?.hasPassword && !form.password)} onClick={save}>
          {busy === 'save' ? 'កំពុងរក្សាទុក និងពិនិត្យ…' : '💾 រក្សាទុក និងពិនិត្យ'}
        </button>
      </div>
    </div>
  );
}

/** 🌐 The platforms new logins pick from (super admins): name, API URL, Basic, headers. */
function PlatformsForm({ platforms, onSaved }) {
  const [list, setList] = useState(platforms.length ? platforms : [{ name: '', baseUrl: '', basicAuth: '', headers: NEW.headers }]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const change = (i, patch) => { setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p))); setNote(null); };
  const save = () => {
    setBusy(true);
    call('loginDefaults', { platforms: list })
      .then((r) => { setList(r.platforms); onSaved(r.platforms); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setNote(`⚠️ ${e.parameters?.index !== undefined ? `#${e.parameters.index + 1} · ` : ''}${FIELD_ERRORS[e.parameters?.field] ?? e.message}`))
      .finally(() => setBusy(false));
  };
  return (
    <Fold title="🌐 Platform" summary={platforms.length ? platforms.map((p) => p.name).join(' · ') : 'មិនទាន់កំណត់'}>
      <p className="muted small">Login ថ្មីជ្រើស Platform មួយ ហើយដាក់តែ Username និង Password។</p>
      {list.map((p, i) => (
        <div key={i} className="login-form">
          <div className="row">
            <input className="field grow" placeholder="ឈ្មោះ (ឧ. VN1)" value={p.name} onChange={(e) => change(i, { name: e.target.value })} />
            <button className="icon small" onClick={() => { setList(list.filter((_, j) => j !== i)); setNote(null); }} aria-label="Remove">🗑</button>
          </div>
          <input className="field" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://example.com/api/v1.0.0" value={p.baseUrl} onChange={(e) => change(i, { baseUrl: e.target.value })} />
          <input className="field mono" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Basic … (ស្រេចចិត្ត)" value={p.basicAuth} onChange={(e) => change(i, { basicAuth: e.target.value })} />
          <textarea className="field mono" rows={2} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="platformtype: p99l" value={p.headers} onChange={(e) => change(i, { headers: e.target.value })} />
        </div>
      ))}
      <div className="row">
        <button className="icon small" onClick={() => setList([...list, { name: '', baseUrl: '', basicAuth: '', headers: NEW.headers }])}>➕ Platform</button>
        <span className="small grow">{note}</span>
        <button className="btn small" disabled={busy} onClick={save}>{busy ? '…' : '💾 រក្សាទុក'}</button>
      </div>
    </Fold>
  );
}

// ---------------------------------------------------------------- 🔗 link to groups
/** Group name and member text in lower case, cut into words of 3+ letters or digits. */
const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** The member whose username or nickname shares the most words with the group's name, or null. */
function suggest(groupName, members) {
  const want = words(groupName);
  let best = null;
  let score = 0;
  for (const m of members) {
    const text = `${m.username} ${m.nickname ?? ''}`.toLowerCase();
    const n = want.filter((w) => text.includes(w)).length;
    if (n > score) { best = m; score = n; }
  }
  return best;
}

/** One login's 🔗: each of the caller's groups with a member to follow, saved row by row. */
function LinkGroups({ login, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({}); // tgId → userCode
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const load = () => call('loginLinks', { loginId: login.id }).then(setData, setError);
  useEffect(() => { load(); }, [login.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error small">{error.message}</p>;
  if (!data) return <SkeletonCard lines={3} />;
  const members = data.people.flatMap((a) => a.members.map((m) => ({ ...m, agentCode: a.agentCode, agent: a.agent })));
  const filter = q.trim().toLowerCase();
  const shown = (m) => !filter || `${m.username} ${m.nickname ?? ''} ${m.agent}`.toLowerCase().includes(filter);
  const link = (g, code) => {
    const m = members.find((x) => x.userCode === code);
    const config = m
      ? { enabled: true, loginId: login.id, memberCode: m.userCode, memberName: m.username, agentCode: m.agentCode }
      : { enabled: false, loginId: 0, memberCode: '', memberName: '', agentCode: '' };
    setBusy(g.tgId);
    call('dailySave', { groupId: g.tgId, config })
      .then((r) => {
        setData({ ...data, groups: data.groups.map((x) => (x.tgId === g.tgId ? { ...x, config: r.config } : x)) });
        setNotes((n) => ({ ...n, [g.tgId]: m ? '✅ បានភ្ជាប់' : '⏸ បានបិទ' }));
        onChanged?.();
      })
      .catch((e) => setNotes((n) => ({ ...n, [g.tgId]: `⚠️ ${e.message}` })))
      .finally(() => setBusy(null));
  };
  const linked = data.groups.filter((g) => g.config.enabled && g.config.loginId === login.id).length;

  return (
    <div className="links">
      <div className="row">
        <strong className="grow">🔗 ភ្ជាប់ក្រុម · 🔑 {login.username}</strong>
        <button className="icon small" onClick={onClose}>✕</button>
      </div>
      <p className="muted small">ជ្រើសសមាជិកសម្រាប់ក្រុមនីមួយៗ — ក្នុងក្រុម គេឃើញតែរបាយការណ៍របស់សមាជិកនោះ។ ⭐ = ឈ្មោះស្រដៀងឈ្មោះក្រុម។ ភ្ជាប់រួច {kh(linked)}/{kh(data.groups.length)}។</p>
      {!members.length && <p className="muted small">⚠️ Login នេះមិនទាន់មានសមាជិក — ចុច «🔄 ពិនិត្យ Login + បញ្ជី»។</p>}
      {members.length > 8 && <input className="field" placeholder="🔍 ស្វែងរកសមាជិក…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {!data.groups.length && <p className="muted small">មិនទាន់មានក្រុមដែលអ្នកគ្រប់គ្រងទេ។</p>}
      {data.groups.map((g) => {
        const mineNow = g.config.enabled && g.config.loginId === login.id;
        const best = suggest(g.name, members);
        const value = picked[g.tgId] ?? (mineNow ? g.config.memberCode : best?.userCode ?? '');
        const options = members.filter((m) => shown(m) || m.userCode === value);
        return (
          <div key={g.tgId} className="link-row">
            <div className="small"><strong>🏪 {g.name}</strong></div>
            <div className={`small ${mineNow ? 'ok' : 'muted'}`}>
              {g.locked ? '🔒 ប្រើ Login របស់អ្នកផ្សេង' : mineNow ? `✅ 👤 ${g.config.memberName}` : g.config.enabled ? '↪️ ប្រើ Login ផ្សេង' : '⏸ មិនទាន់ភ្ជាប់'}
            </div>
            {!g.locked && members.length > 0 && (
              <div className="row">
                <select className="field grow" value={value} onChange={(e) => setPicked({ ...picked, [g.tgId]: e.target.value })}>
                  <option value="">— ជ្រើសសមាជិក —</option>
                  {options.map((m) => (
                    <option key={m.userCode} value={m.userCode}>{m.userCode === best?.userCode ? '⭐ ' : ''}👤 {m.username}{m.nickname ? ` · ${m.nickname}` : ''}</option>
                  ))}
                </select>
                {value && value !== (mineNow ? g.config.memberCode : '') && (
                  <button className="btn small" disabled={busy === g.tgId} onClick={() => link(g, value)}>{busy === g.tgId ? '…' : '✅ ភ្ជាប់'}</button>
                )}
                {mineNow && value === g.config.memberCode && (
                  <button className="icon small" disabled={busy === g.tgId} onClick={() => link(g, '')}>បិទ</button>
                )}
              </div>
            )}
            {notes[g.tgId] && <div className="small">{notes[g.tgId]}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function Logins({ standalone = false }) {
  const [logins, setLogins] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [canEditPlatforms, setCanEditPlatforms] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [linking, setLinking] = useState(null); // login id
  const [busy, setBusy] = useState(null); // `${action} ${id}`
  const [notes, setNotes] = useState({}); // id → text
  const [error, setError] = useState(null);
  useEffect(() => {
    call('logins').then((r) => { setLogins(r.logins); setPlatforms(r.platforms ?? []); setCanEditPlatforms(!!r.canEditPlatforms); }, setError);
  }, []);

  const note = (id, text) => setNotes((n) => ({ ...n, [id]: text }));
  const checked = (check) => (check?.ok ? `✅ Login ជោគជ័យ · 🧑‍💼 ${kh(check.agents)} · 👤 ${kh(check.members)}` : `⚠️ Login មិនជោគជ័យ: ${check?.error ?? ''}`);
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
      .then((r) => note(l.id, [...r.reports.map((x) => `${x.ok ? '✅' : '⚠️'} ${x.who}${x.ok ? '' : ` — ${x.error}`}`), r.members && (r.members.error ? `⚠️ សមាជិក — ${r.members.error}` : `✅ 👤 ${kh(r.members.count)} សមាជិក`), r.agents && (r.agents.error ? `⚠️ ភ្នាក់ងារ — ${r.agents.error}` : `✅ 🧑‍💼 ${kh(r.agents.count)} ភ្នាក់ងារ`), r.totalsError ? `⚠️ សរុប — ${r.totalsError}` : '✅ សរុបសមាជិក'].filter(Boolean).join('\n')))
      .catch((e) => note(l.id, `⚠️ ${e.message}`))
      .finally(() => setBusy(null));
  };
  const saved = (list, id, check) => {
    setLogins(list);
    setEditing(null);
    note(id, checked(check));
    // Signed in: straight on to 🔗 linking it to groups.
    if (check?.ok) setLinking(id);
  };

  if (!logins && !error) return <SkeletonCard lines={2} />;
  if (!logins) return <Fold title="🔑 Login ឆ្នោត" summary={`⚠️ ${error.message}`} />;
  const running = logins.filter((l) => l.enabled).length;
  const body = (
    <>
      {!logins.length && editing !== 'new' && (
        <div className="steps">
          <div><strong>① ➕ បន្ថែម Login</strong> <span className="muted small">— Username និង Password</span></div>
          <div><strong>② 🔗 ភ្ជាប់ក្រុម</strong> <span className="muted small">— ជ្រើសសមាជិកសម្រាប់ក្រុមនីមួយៗ</span></div>
          <div><strong>③ ✅ រួចរាល់</strong> <span className="muted small">— Bot ទាញរបាយការណ៍តាមម៉ោង</span></div>
        </div>
      )}
      {logins.map((l) => (editing === l.id ? (
        <LoginForm key={l.id} login={l} platforms={platforms} onCancel={() => setEditing(null)}
          onSaved={saved} onDeleted={(list) => { setLogins(list); setEditing(null); }} />
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
            <button className="btn grow small" onClick={() => setLinking(linking === l.id ? null : l.id)}>🔗 ភ្ជាប់ក្រុម</button>
            <button className="icon grow small" disabled={!!busy} onClick={() => sync(l)}>{busy === `sync ${l.id}` ? 'កំពុងទាញ…' : '🔄 ពិនិត្យ'}</button>
            <button className="icon grow small" disabled={!!busy} onClick={() => run(l)}>{busy === `run ${l.id}` ? 'កំពុងទាញ…' : '▶️ ទាញឥឡូវ'}</button>
          </div>
          {notes[l.id] && <pre className="note small">{notes[l.id]}</pre>}
          {linking === l.id && <LinkGroups login={l} onClose={() => setLinking(null)} onChanged={() => call('logins').then((r) => setLogins(r.logins), () => {})} />}
        </div>
      )))}
      {editing === 'new' ? (
        <LoginForm platforms={platforms} onCancel={() => setEditing(null)} onSaved={saved} onDeleted={() => {}} />
      ) : (
        <button className="btn" onClick={() => setEditing('new')}>➕ បន្ថែម Login</button>
      )}
      {canEditPlatforms && <PlatformsForm platforms={platforms} onSaved={setPlatforms} />}
    </>
  );
  // A manager's 🔑 tab is this screen alone: open, not folded.
  if (standalone) return <section className="card">{body}</section>;
  return (
    <Fold title="🔑 Login ឆ្នោត" summary={logins.length ? `${kh(logins.length)} Login · ${kh(running)} កំពុងដំណើរការ · ${logins.map((l) => l.username).join(', ')}` : 'មិនទាន់មាន Login'} start={!logins.length}>
      {body}
    </Fold>
  );
}
