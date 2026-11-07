// ☁️ A group's OneDrive (in its 📥 ឆ្នោត tab): every 📊 Excel this group makes
// (🔘 Excel taps and 📤 auto-send) is also saved to a folder in a OneDrive.
// "🔗 ភ្ជាប់ OneDrive" opens Microsoft's sign-in; back here, it refreshes.

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { Switch } from './Logins.jsx';

const tg = window.Telegram?.WebApp;
const ERRORS = { account: 'សូមជ្រើសគណនី OneDrive' };

export default function OneDrive({ group }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);

  const load = () => call('onedriveGet', { groupId: group.tgId })
    .then((r) => { setData(r); setForm(r.config); })
    .catch((e) => setNote(`⚠️ ${e.message}`));
  useEffect(() => {
    load();
    // Back from Microsoft's sign-in (another app / browser): show the new account.
    const back = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [group.tgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !form) return null;
  const set = (patch) => { setForm({ ...form, ...patch }); setNote(null); };
  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);
  const account = data.accounts.find((a) => a.id === data.config.accountId);

  const connect = () => {
    setBusy('connect');
    call('onedriveConnect', { groupId: group.tgId })
      .then((r) => { if (tg?.openLink) tg.openLink(r.url); else window.open(r.url, '_blank'); setNote('🔗 ចូល Microsoft ហើយចុច Accept — រួចត្រឡប់មកទីនេះវិញ។'); })
      .catch((e) => setNote(`⚠️ ${e.message}`))
      .finally(() => setBusy(''));
  };
  const save = () => {
    setBusy('save');
    call('onedriveSave', { groupId: group.tgId, ...form })
      .then((r) => { setData({ ...data, config: r.config }); setForm(r.config); setNote('✅ បានរក្សាទុក'); })
      .catch((e) => setNote(`⚠️ ${ERRORS[e.parameters?.field] ?? e.message}`))
      .finally(() => setBusy(''));
  };
  const remove = (a) => {
    if (!window.confirm(`ផ្ដាច់ OneDrive ${a.email || a.name}? ក្រុមដែលប្រើវានឹងឈប់ផ្ញើ។`)) return;
    setBusy('remove');
    call('onedriveRemove', { accountId: a.id }).then(load).catch((e) => setNote(`⚠️ ${e.message}`)).finally(() => setBusy(''));
  };

  const summary = data.config.enabled && account ? `✅ ${account.email || account.name} · 📁 ${data.config.folder}` : '⏸ បិទ';
  return (
    <section className="card autosend">
      <div className="row">
        <div className="grow">
          <strong>☁️ OneDrive</strong>
          <div className={`small ${data.config.enabled && account ? 'ok' : 'muted'}`}>{summary}</div>
        </div>
        {data.accounts.length > 0 && <Switch on={form.enabled} onChange={(enabled) => set({ enabled, accountId: form.accountId || data.accounts[0].id })} label="OneDrive" />}
      </div>
      <p className="muted small">រាល់ 📊 Excel ដែលក្រុមនេះបង្កើត (ចុចប៊ូតុង ឬ 📤 ផ្ញើស្វ័យប្រវត្តិ) ក៏រក្សាទុកក្នុង OneDrive ដែរ — ឯកសារខែដដែលត្រូវជំនួស។</p>
      {!data.ready && <p className="small">⚠️ Server មិនទាន់កំណត់ OneDrive (MS_CLIENT_ID / MS_CLIENT_SECRET) ទេ។</p>}

      {data.accounts.length > 0 && (
        <>
          <div className="small">គណនី</div>
          <div className="checks">
            {data.accounts.map((a) => (
              <label key={a.id} className="check">
                <input type="radio" name={`od-${group.tgId}`} checked={form.accountId === a.id} onChange={() => set({ accountId: a.id })} />
                <span className="grow">{a.email || a.name}{a.error ? <span className="small"> · ⚠️ ត្រូវភ្ជាប់ម្ដងទៀត</span> : null}{!a.mine ? <span className="muted small"> · អ្នកផ្សេងភ្ជាប់</span> : null}</span>
                {a.mine && <button className="icon" disabled={!!busy} onClick={(e) => { e.preventDefault(); remove(a); }} aria-label="ផ្ដាច់">🗑</button>}
              </label>
            ))}
          </div>
          <label className="label">
            <span className="small">📁 Folder</span>
            <input className="field" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="SumUp/ក្រុម" value={form.folder} onChange={(e) => set({ folder: e.target.value })} />
            <span className="muted small">ឧ. {form.folder || 'SumUp'}/agent-2026-11.xlsx</span>
          </label>
        </>
      )}

      <button className="btn" disabled={!!busy || !data.ready} onClick={connect}>{busy === 'connect' ? 'កំពុងបើក…' : data.accounts.length ? '🔗 ភ្ជាប់ OneDrive ផ្សេងទៀត' : '🔗 ភ្ជាប់ OneDrive'}</button>

      {note && <p className="small">{note}</p>}
      {dirty && (
        <div className="row">
          <button className="icon" disabled={!!busy} onClick={() => { setForm(data.config); setNote(null); }}>បោះបង់</button>
          <button className="btn grow" disabled={!!busy} onClick={save}>{busy === 'save' ? 'កំពុងរក្សាទុក…' : '💾 រក្សាទុក'}</button>
        </div>
      )}
    </section>
  );
}
