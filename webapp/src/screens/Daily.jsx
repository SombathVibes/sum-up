// A group's lottery report (super admins): on/off, and the one member the
// group follows, picked from the members saved under the 🔑 logins (⚙️
// Settings). The logins hold the API, credentials and run times; in the group,
// people see only this member's report and totals.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { Switch, kh } from './Logins.jsx';
import Skeleton from '../components/Skeleton.jsx';
import AutoSend from './AutoSend.jsx';
import OneDrive from './OneDrive.jsx';

export default function DailyPanel({ group }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => call('dailyGet', { groupId: group.tgId }).then((r) => { setData(r); setForm(r.config); }, setError);
  useEffect(() => { load(); }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!form) return <main className="content"><Skeleton cards={2} /></main>;

  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); setError(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);
  // Every member under every login, keyed by login + code (the same member may be under two logins).
  const options = data.logins.flatMap((l) => l.people.flatMap((a) => a.members.map((m) => ({ ...m, loginId: l.id, agentCode: a.agentCode }))));
  const value = form.memberCode ? `${form.loginId}:${form.memberCode}` : '';
  const pick = (v) => {
    const hit = options.find((m) => `${m.loginId}:${m.userCode}` === v);
    set(hit ? { loginId: hit.loginId, memberCode: hit.userCode, memberName: hit.username, agentCode: hit.agentCode } : { loginId: 0, memberCode: '', memberName: '', agentCode: '', enabled: false });
  };
  const save = () => {
    setBusy(true);
    call('dailySave', { groupId: group.tgId, config: form })
      .then((r) => { setData({ ...data, config: r.config }); setForm(r.config); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setError(e.parameters?.field === 'member' ? new Error('សូមជ្រើសសមាជិកជាមុន') : e))
      .finally(() => setBusy(false));
  };
  const known = !form.memberCode || options.some((m) => `${m.loginId}:${m.userCode}` === value);

  // Following another admin's login: a manager sees it, but can't change it.
  if (data.locked) {
    return (
      <main className="content daily">
        <section className="card">
          <strong>📥 របាយការណ៍ឆ្នោត</strong>
          <div className={`small ${data.config.enabled ? 'ok' : 'muted'}`}>{data.config.enabled ? `✅ បើក · 👤 ${data.config.memberName || data.config.memberCode}` : '⏸ បិទ'}</div>
          <p className="muted small">🔒 ក្រុមនេះប្រើ Login របស់អ្នកគ្រប់គ្រងផ្សេង — មានតែ Super admin ទេដែលអាចកែបាន។</p>
        </section>
        {/* 📤 a group's managers set its auto-send, whoever added the login. */}
        {data.config.loginId > 0 && data.autoSend && <AutoSend key={data.config.loginId} group={group} initial={data.autoSend} agents={data.agents ?? []} />}
        {data.config.loginId > 0 && <OneDrive group={group} />}
      </main>
    );
  }

  return (
    <main className="content daily">
      <section className="card">
        <div className="row">
          <div className="grow">
            <strong>📥 របាយការណ៍ឆ្នោត</strong>
            <div className={`small ${data.config.enabled ? 'ok' : 'muted'}`}>
              {data.config.enabled ? `✅ បើក · 👤 ${data.config.memberName || data.config.memberCode}` : '⏸ បិទ'}
            </div>
          </div>
          <Switch on={form.enabled} onChange={(enabled) => set({ enabled })} label="របាយការណ៍ឆ្នោត" />
        </div>
      </section>

      <section className="card">
        <strong>👤 សមាជិករបស់ក្រុមនេះ</strong>
        <p className="muted small">ក្នុងក្រុម គេឃើញតែរបាយការណ៍ និងសរុបរបស់សមាជិកនេះប៉ុណ្ណោះ។</p>
        {data.logins.length ? (
          <select className="field" value={value} onChange={(e) => pick(e.target.value)}>
            <option value="">— ជ្រើសសមាជិក —</option>
            {!known && <option value={value}>👤 {form.memberName || form.memberCode}</option>}
            {data.logins.map((l) => l.people.map((a) => (
              <optgroup key={`${l.id}:${a.agentCode}`} label={`🔑 ${l.username} · 🧑‍💼 ${a.agent}${a.agentNick ? ` · ${a.agentNick}` : ''}`}>
                {a.members.map((m) => <option key={m.userCode} value={`${l.id}:${m.userCode}`}>👤 {m.username}{m.nickname ? ` · ${m.nickname}` : ''}</option>)}
              </optgroup>
            )))}
          </select>
        ) : (
          <p className="muted small">មិនទាន់មាន 🔑 Login ទេ — បន្ថែមនៅ ⚙️ ការកំណត់ (🔑 Login)។</p>
        )}
        {data.logins.length > 0 && !options.length && <p className="muted small">Login មិនទាន់មានបញ្ជីសមាជិក — ចុច «🔄 ពិនិត្យ Login + បញ្ជី» នៅ ⚙️ ការកំណត់។</p>}
        <p className="muted small">🔑 {kh(data.logins.length)} Login · 👤 {kh(options.length)} សមាជិក</p>
      </section>

      {data.config.loginId > 0 && data.autoSend && <AutoSend key={data.config.loginId} group={group} initial={data.autoSend} agents={data.agents ?? []} />}
        {data.config.loginId > 0 && <OneDrive group={group} />}

      {error && <p className="error">{error.message}</p>}
      {note && <p className="small">{note}</p>}
      {dirty && (
        <div className="savebar">
          <button className="icon" disabled={busy} onClick={() => { setForm(data.config); setNote(null); setError(null); }}>បោះបង់</button>
          <button className="btn grow" disabled={busy} onClick={save}>{busy ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
        </div>
      )}
    </main>
  );
}
