// Payment settings (super admins): the monthly price and the account details
// customers see on ⭐ ការជាវ. Defaults come from config.js; the QR photo is
// still set in chat with /setqr.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { money } from '../format.js';

const FIELDS = [
  ['bank', '🏦 ធនាគារ', 40],
  ['accountName', '👤 ឈ្មោះគណនី', 60],
  ['accountNumber', '💳 លេខគណនី', 40],
  ['supportLink', '💬 Link ផ្ញើវិក្កយបត្រ (https://t.me/…)', 200],
];
const LABEL = { price: 'តម្លៃ', currency: 'រូបិយប័ណ្ណ', instructions: 'សេចក្តីណែនាំ', bank: 'ធនាគារ', accountName: 'ឈ្មោះគណនី', accountNumber: 'លេខគណនី', supportLink: 'Link' };

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
      {data.billingMode !== 'manual' && <p className="muted small">⚠️ BILLING_MODE = '{data.billingMode}' — ព័ត៌មានគណនីនេះប្រើតែពេលបង់ដោយដៃ។</p>}

      <section className="card">
        <strong>💵 តម្លៃប្រចាំខែ / ក្រុម</strong>
        <div className="row">
          <input className="field grow" inputMode="decimal" value={form.price} onChange={set('price')} />
          <div className="segmented small">
            {['USD', 'KHR'].map((c) => (
              <button key={c} className={form.currency === c ? 'on' : ''} onClick={() => { setForm({ ...form, currency: c }); setSaved(null); }}>{c === 'USD' ? '$ USD' : '៛ KHR'}</button>
            ))}
          </div>
        </div>
        <p className="muted small">ប្រើពេលកត់ត្រាការបន្ត (Renew) និងបង្ហាញលើ ⭐ ការជាវ។</p>
      </section>

      <section className="card">
        <strong>🏦 ព័ត៌មានបង់ប្រាក់</strong>
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
        <p className="muted small">🖼 QR: {data.hasQr ? 'មានរួចហើយ' : 'មិនទាន់មាន'} — ផ្ញើរូប QR ជាមួយ caption /setqr ក្នុង chat ជាមួយ bot ដើម្បីប្តូរ។</p>
      </section>

      {error && <p className="error">{error.message}</p>}
      {saved && <p className="small">{saved}</p>}
      <button className="btn wide" disabled={busy || !dirty} onClick={save}>{busy ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
      <button className="icon wide" onClick={reset}>↩️ ត្រឡប់ទៅតម្លៃដើម (config.js)</button>
    </main>
  );
}
