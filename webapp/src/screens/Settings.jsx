// Settings (super admins): the 🔑 lottery logins (Logins.jsx), the monthly
// price and the account details customers see on ⭐ ការជាវ (defaults come from
// config.js), and the two files the bot uses: the payment QR and the agent
// Excel template (also settable in chat with /setqr and /settemplate).

import { useEffect, useRef, useState } from 'react';
import { call } from '../api.js';
import { money } from '../format.js';
import Fold from './Fold.jsx';
import Logins from './Logins.jsx';

const FIELDS = [
  ['bank', '🏦 ធនាគារ', 40],
  ['accountName', '👤 ឈ្មោះគណនី', 60],
  ['accountNumber', '💳 លេខគណនី', 40],
  ['supportLink', '💬 Link ផ្ញើវិក្កយបត្រ (https://t.me/…)', 200],
];
const LABEL = { price: 'តម្លៃ', currency: 'រូបិយប័ណ្ណ', instructions: 'សេចក្តីណែនាំ', bank: 'ធនាគារ', accountName: 'ឈ្មោះគណនី', accountNumber: 'លេខគណនី', supportLink: 'Link' };

const MAX_UPLOAD = 5 * 1024 * 1024;

/** A File's bytes as base64 (for the uploadFile endpoint). */
const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

/** One file setting: its state and an upload button (picks a file, sends it at once). */
function Upload({ icon, title, accept, kind, current, onDone }) {
  const input = useRef(null);
  const [state, setState] = useState(null); // null | 'busy' | { ok } | { error }
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD) { setState({ error: 'ឯកសារត្រូវតែតូចជាង 5 MB' }); return; }
    setState('busy');
    try {
      const r = await call('uploadFile', { kind, name: file.name, data: await toBase64(file) });
      setState({ ok: `✅ បានរក្សាទុក ${r.name}` });
      onDone(r);
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <div className="row upload">
      <div className="grow">
        <div className="small">{icon} {title}</div>
        <div className={`small ${current ? 'ok' : 'muted'}`}>{current ? `បានរក្សាទុក ✓ ${current === true ? '' : current}` : 'មិនទាន់មាន'}</div>
        {state?.ok && <div className="small">{state.ok}</div>}
        {state?.error && <div className="small error">⚠️ {state.error}</div>}
      </div>
      <input ref={input} type="file" accept={accept} hidden onChange={pick} />
      <button className="btn small" disabled={state === 'busy'} onClick={() => input.current?.click()}>
        {state === 'busy' ? 'កំពុងផ្ញើ…' : current ? '🔄 ប្តូរ' : '📤 ផ្ញើ'}
      </button>
    </div>
  );
}

/** Hundredths ↔ the text in the price box ('5', '12.5'). */
const priceText = (cents) => money(cents).replace(/,/g, '');
const priceCents = (text) => Math.round(Number(String(text).replace(/,/g, '')) * 100);

export default function Settings() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  const fill = (r) => { setData(r); setForm({ ...r.payment, price: priceText(r.payment.price) }); };
  useEffect(() => { call('settings').then(fill, setError); }, []);

  if (error && !data) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!form) return <main className="content"><p className="center muted">កំពុងផ្ទុក…</p></main>;

  const set = (key) => (e) => { setForm({ ...form, [key]: e.target.value }); setSaved(null); };
  const dirty = JSON.stringify({ ...form, price: priceCents(form.price) }) !== JSON.stringify(data.payment);
  const save = () => {
    setBusy(true);
    setError(null);
    call('settingsSave', { payment: { ...form, price: priceCents(form.price) } })
      .then((r) => { fill({ ...data, payment: r.payment }); setSaved('✅ បានរក្សាទុក'); })
      .catch((e) => setError(e.parameters?.field ? new Error(`សូមពិនិត្យ «${LABEL[e.parameters.field] ?? e.parameters.field}»`) : e))
      .finally(() => setBusy(false));
  };
  const reset = () => { setForm({ ...data.defaults, price: priceText(data.defaults.price) }); setSaved(null); };

  return (
    <main className="content">
      <Logins />

      {data.billingMode !== 'manual' && <p className="muted small">⚠️ BILLING_MODE = '{data.billingMode}' — ព័ត៌មានគណនីនេះប្រើតែពេលបង់ដោយដៃ។</p>}

      <Fold title="💵 តម្លៃប្រចាំខែ / ក្រុម" summary={`${form.price || '—'} ${form.currency}`}>
        <div className="row">
          <input className="field grow" inputMode="decimal" value={form.price} onChange={set('price')} />
          <div className="segmented small">
            {['USD', 'KHR'].map((c) => (
              <button key={c} className={form.currency === c ? 'on' : ''} onClick={() => { setForm({ ...form, currency: c }); setSaved(null); }}>{c === 'USD' ? '$ USD' : '៛ KHR'}</button>
            ))}
          </div>
        </div>
        <p className="muted small">ប្រើពេលកត់ត្រាការបន្ត (Renew) និងបង្ហាញលើ ⭐ ការជាវ។</p>
      </Fold>

      <Fold title="🏦 ព័ត៌មានបង់ប្រាក់" summary={[form.bank, form.accountName, form.accountNumber].filter(Boolean).join(' · ') || 'មិនទាន់កំណត់'}>
        {FIELDS.map(([key, label, max]) => (
          <label key={key} className="label">
            <span className="muted small">{label}</span>
            <input className="field" value={form[key]} maxLength={max} onChange={set(key)} />
          </label>
        ))}
        <label className="label">
          <span className="muted small">📝 សេចក្តីណែនាំ</span>
          <textarea className="field" rows={3} value={form.instructions} maxLength={500} onChange={set('instructions')} />
        </label>
      </Fold>

      <Fold title="📎 ឯកសារ" summary={`🖼 QR ${data.hasQr ? '✓' : '—'} · 📊 Template ${data.template ? '✓' : '—'}`}>
        <Upload icon="🖼" title="QR បង់ប្រាក់ (PNG / JPG)" accept="image/png,image/jpeg" kind="qr" current={data.hasQr}
          onDone={() => setData({ ...data, hasQr: true })} />
        <Upload icon="📊" title="Template Excel ភ្នាក់ងារ (.xlsx)" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" kind="template" current={data.template}
          onDone={(r) => setData({ ...data, template: r.name })} />
      </Fold>

      {error && <p className="error">{error.message}</p>}
      {saved && <p className="small">{saved}</p>}
      <button className="btn wide" disabled={busy || !dirty} onClick={save}>{busy ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
      <button className="icon wide" onClick={reset}>↩️ ត្រឡប់ទៅតម្លៃដើម (config.js)</button>
    </main>
  );
}
