// 📤 A group's auto-send (in its 📥 ឆ្នោត tab): at the chosen time each day the
// bot posts today's 🖼 album and/or the month's 📊 Excel for the picked agents
// into the group; ⚠️ optionally, a private alert to whoever saved this when
// the group's member's day passes ± an amount.

import { useState } from 'react';
import { call } from '../api.js';
import { Switch, kh } from './Logins.jsx';

const ERRORS = {
  time: 'សូមជ្រើសម៉ោង',
  agents: 'សូមជ្រើសភ្នាក់ងារយ៉ាងហោចណាស់មួយ (អតិបរមា ១០)',
  what: 'សូមជ្រើស 🖼 រូបភាព ឬ 📊 Excel',
  alert: 'ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ',
};

export default function AutoSend({ group, initial, agents }) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); };
  const toggleAgent = (id) => set({ agentIds: form.agentIds.includes(id) ? form.agentIds.filter((x) => x !== id) : [...form.agentIds, id] });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const save = () => {
    setBusy(true);
    call('autoSendSave', { groupId: group.tgId, autoSend: { ...form, alertAmount: Number(String(form.alertAmount).replace(/[^\d]/g, '')) || 0 } })
      .then((r) => { setSaved(r.autoSend); setForm(r.autoSend); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setNote(`⚠️ ${ERRORS[e.parameters?.field] ?? e.message}`))
      .finally(() => setBusy(false));
  };
  const summary = saved.enabled
    ? `✅ ⏰ ${saved.time} · ${[saved.sendImage && '🖼', saved.sendExcel && '📊'].filter(Boolean).join(' ')} · 🧑‍💼 ${kh(saved.agentIds.length)}`
    : '⏸ បិទ';

  return (
    <section className="card autosend">
      <div className="row">
        <div className="grow">
          <strong>📤 ផ្ញើស្វ័យប្រវត្តិ</strong>
          <div className={`small ${saved.enabled ? 'ok' : 'muted'}`}>{summary}</div>
        </div>
        <Switch on={form.enabled} onChange={(enabled) => set({ enabled })} label="ផ្ញើស្វ័យប្រវត្តិ" />
      </div>
      <p className="muted small">រៀងរាល់ថ្ងៃ តាមម៉ោងនេះ bot ផ្ញើរបាយការណ៍ថ្ងៃនេះ របស់ភ្នាក់ងារដែលបានជ្រើស ចូលក្រុមនេះ។</p>

      <div className="row">
        <span className="small grow">⏰ ម៉ោង <span className="muted">(ភ្នំពេញ)</span></span>
        <input className="field time" type="time" value={form.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
      </div>

      <div className="small">ផ្ញើ</div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={form.sendImage} onChange={(e) => set({ sendImage: e.target.checked })} /> 🖼 រូបភាព <span className="muted small">(ថ្ងៃនេះ)</span></label>
        <label className="check"><input type="checkbox" checked={form.sendExcel} onChange={(e) => set({ sendExcel: e.target.checked })} /> 📊 Excel <span className="muted small">(ខែនេះ ដល់ម្សិលមិញ)</span></label>
      </div>

      <div className="small">🧑‍💼 ភ្នាក់ងារ</div>
      {agents.length ? (
        <div className="checks">
          {agents.map((a) => (
            <label key={a.id} className="check">
              <input type="checkbox" checked={form.agentIds.includes(a.id)} onChange={() => toggleAgent(a.id)} /> {a.username}{a.nickname ? <span className="muted small"> · {a.nickname}</span> : null}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted small">Login នេះមិនទាន់មានបញ្ជីភ្នាក់ងារ — ចុច «🔄 ពិនិត្យ» នៅ 🔑 Login។</p>
      )}

      <label className="label">
        <span className="small">⚠️ ជូនដំណឹងខ្ញុំ ពេលថ្ងៃនេះលើស ± <span className="muted">(៛ · ទុកទទេ = បិទ)</span></span>
        <input className="field" inputMode="numeric" placeholder="ឧ. 500000" value={form.alertAmount || ''} onChange={(e) => set({ alertAmount: e.target.value.replace(/[^\d]/g, '') })} />
        <span className="muted small">ផ្ញើមកអ្នក (Chat ផ្ទាល់) ម្ដងក្នុងមួយថ្ងៃ{saved.enabled && !saved.mine ? ' · ⚠️ ឥឡូវផ្ញើទៅអ្នកដែលបានរក្សាទុកមុន' : ''}។</span>
      </label>

      {note && <p className="small">{note}</p>}
      {dirty && (
        <div className="row">
          <button className="icon" disabled={busy} onClick={() => { setForm(saved); setNote(null); }}>បោះបង់</button>
          <button className="btn grow" disabled={busy} onClick={save}>{busy ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
        </div>
      )}
    </section>
  );
}
