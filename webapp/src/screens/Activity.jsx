// 📜 Who changed what (super admins, in ⚙️ Settings): the latest 200 changes.

import { useState } from 'react';
import { call } from '../api.js';
import Fold from './Fold.jsx';

const LABEL = {
  'login.add': '🔑 បន្ថែម Login',
  'login.edit': '🔑 កែ Login',
  'login.delete': '🗑 លុប Login',
  'platforms.save': '🌐 Platform',
  'group.lottery': '📥 ឆ្នោតក្រុម',
  'group.autosend': '📤 ផ្ញើស្វ័យប្រវត្តិ',
  'group.onedrive': '☁️ OneDrive ក្រុម',
  'onedrive.connect': '☁️ ភ្ជាប់ OneDrive',
  'onedrive.remove': '☁️ ផ្ដាច់ OneDrive',
  'group.renew': '⭐ បន្តការជាវ',
  'group.lifetime': '♾ Lifetime',
  'settings.payment': '💵 ការបង់ប្រាក់',
  'team.role': '👥 តួនាទី',
  'team.super': '⭐ Super admin',
  'team.remove': '👥 ដកចេញ',
};

const when = (at) => {
  const d = new Date((at + 7 * 3600) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export default function Activity() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  // Loaded when opened, not with the page.
  const load = () => { if (!items) call('activity').then((r) => setItems(r.items), setError); };
  const f = q.trim().toLowerCase();
  const shown = (items ?? []).filter((x) => !f || `${x.who} ${x.target} ${x.detail} ${LABEL[x.action] ?? x.action}`.toLowerCase().includes(f));
  return (
    <Fold title="📜 សកម្មភាព" summary="អ្នកណាកែអ្វី ពេលណា (៩០ ថ្ងៃចុងក្រោយ)" onOpen={load}>
      {error && <p className="error small">{error.message}</p>}
      {!items && !error && <p className="muted small">កំពុងផ្ទុក…</p>}
      {items && (
        <>
          <input className="field" placeholder="🔍 ស្វែងរក…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="activity">
            {shown.map((x, i) => (
              <div key={i} className="item">
                <div className="small"><strong>{LABEL[x.action] ?? x.action}</strong> · {x.target}</div>
                {x.detail && <div className="small">{x.detail}</div>}
                <div className="muted small">👤 {x.who} · {when(x.at)}</div>
              </div>
            ))}
            {!shown.length && <p className="muted small">មិនទាន់មានទេ។</p>}
          </div>
        </>
      )}
    </Fold>
  );
}
