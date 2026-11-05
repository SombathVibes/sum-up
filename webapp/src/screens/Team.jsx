// The admin team (super admins): everyone's groups and roles, super admin on
// or off, and removing an admin. New admins are added with Telegram's user
// picker in the bot's chat, so ➕ opens it there (t.me/<bot>?start=addadmin).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import Skeleton from '../components/Skeleton.jsx';

const tg = window.Telegram?.WebApp;
const ROLES = [[null, '—'], ['view', '👁 មើល'], ['manage', '🛠 គ្រប់គ្រង']];

const nameOf = (a) => a.name || (a.username ? `@${a.username}` : String(a.userId));

function confirm(text, go) {
  if (tg?.showConfirm) tg.showConfirm(text, (ok) => ok && go());
  else if (window.confirm(text)) go();
}

export default function Team({ me }) {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // userId

  const load = useCallback(() => call('team').then(setTeam, setError), []);
  useEffect(() => { load(); }, [load]);

  // Telegram's Back button closes an opened admin.
  useEffect(() => {
    if (!tg?.BackButton) return undefined;
    const back = () => setOpen(null);
    if (open) { tg.BackButton.show(); tg.BackButton.onClick(back); }
    return () => tg.BackButton.offClick(back);
  }, [open]);

  if (error) return <main className="content"><p className="error">{error.message}</p></main>;
  if (!team) return <main className="content"><Skeleton cards={3} /></main>;

  const admin = open && team.admins.find((a) => a.userId === open);
  if (admin) return <Member admin={admin} groups={team.groups} me={me} onBack={() => setOpen(null)} onChanged={load} />;

  const supers = team.admins.filter((a) => a.isSuper);
  const others = team.admins.filter((a) => !a.isSuper);
  const add = () => {
    const link = `https://t.me/${me.botUsername}?start=addadmin`;
    if (tg?.openTelegramLink) { tg.openTelegramLink(link); tg.close(); } else window.open(link);
  };
  const row = (a) => {
    const roles = Object.values(a.roles);
    return (
      <button key={a.userId} className="card row" onClick={() => setOpen(a.userId)}>
        <span className="grow">
          <strong className="name">{a.isSuper ? '⭐ ' : '👤 '}{nameOf(a)}</strong>
          <span className="muted small">{a.username ? ` @${a.username}` : ''}</span>
        </span>
        <span className="muted small">
          {a.isSuper ? (a.config ? 'config' : 'គ្រប់ក្រុម') : `👁 ${roles.filter((r) => r === 'view').length} · 🛠 ${roles.filter((r) => r === 'manage').length}`}
        </span>
      </button>
    );
  };
  return (
    <main className="content">
      <button className="btn wide" onClick={add}>➕ បន្ថែមអ្នកគ្រប់គ្រង</button>
      <p className="muted small">បើក chat ជាមួយ bot ដើម្បីជ្រើសរើសអ្នកប្រើ។</p>
      <h2>⭐ Super admin ({supers.length})</h2>
      {supers.map(row)}
      <h2>👤 អ្នកគ្រប់គ្រង ({others.length})</h2>
      {others.length ? others.map(row) : <p className="muted">មិនទាន់មានទេ។</p>}
    </main>
  );
}

function Member({ admin, groups, me, onBack, onChanged }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const self = admin.userId === me.id;

  const run = (key, name, input) => {
    setBusy(key);
    setError(null);
    return call(name, input)
      .then(() => { onChanged(); return true; }, (e) => { setError(e); return false; })
      .finally(() => setBusy(null));
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Their groups first, then A–Z.
    return groups
      .filter((g) => !needle || g.name.toLowerCase().includes(needle))
      .sort((a, b) => (admin.roles[b.tgId] ? 1 : 0) - (admin.roles[a.tgId] ? 1 : 0) || a.name.localeCompare(b.name));
  }, [groups, q, admin.roles]);

  return (
    <main className="content">
      <div className="row">
        <button className="icon" onClick={onBack} aria-label="Back">←</button>
        <div className="grow">
          <strong>{nameOf(admin)}</strong>
          <div className="muted small">
            {admin.username ? <a href={`https://t.me/${admin.username}`}>@{admin.username}</a> : null} · <code>{admin.userId}</code>
          </div>
        </div>
      </div>
      {error && <p className="error">{error.message}</p>}

      <section className="card">
        <div className="row">
          <span>⭐ Super admin</span>
          {admin.config || self
            ? <span className="muted small">{admin.config ? 'កំណត់ក្នុង config.js' : 'អ្នកផ្ទាល់'}</span>
            : (
              <button className={`btn small${admin.isSuper ? '' : ' off'}`} disabled={!!busy}
                onClick={() => confirm(admin.isSuper ? `ដក Super admin ពី ${nameOf(admin)}?` : `ធ្វើឲ្យ ${nameOf(admin)} ជា Super admin? គាត់នឹងមានគ្រប់សិទ្ធិ។`,
                  () => run('super', 'teamSuper', { userId: admin.userId, on: !admin.isSuper }))}>
                {admin.isSuper ? 'ON' : 'OFF'}
              </button>
            )}
        </div>
        <p className="muted small">គ្រប់ក្រុម និងគ្រប់សិទ្ធិ រួមទាំងគ្រប់គ្រងអ្នកគ្រប់គ្រង។</p>
      </section>

      {!admin.isSuper && (
        <>
          <h2>ក្រុម ({Object.keys(admin.roles).length}/{groups.length})</h2>
          <p className="muted small">👁 មើលរបាយការណ៍ · 🛠 + Sync, Renew, History</p>
          {groups.length > 8 && <input className="search" placeholder="🔍 ស្វែងរកក្រុម" value={q} onChange={(e) => setQ(e.target.value)} />}
          {shown.map((g) => {
            const role = admin.roles[g.tgId] ?? null;
            return (
              <section key={g.tgId} className="card">
                <strong className="name">🏪 {g.name}</strong>
                <div className="segmented small">
                  {ROLES.map(([r, label]) => (
                    <button key={label} className={role === r ? 'on' : ''} disabled={busy === g.tgId}
                      onClick={() => role !== r && run(g.tgId, 'teamRole', { userId: admin.userId, groupId: g.tgId, role: r })}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {!admin.config && !self && (
        <button className="btn wide danger" disabled={!!busy}
          onClick={() => confirm(`លុប ${nameOf(admin)} ពីអ្នកគ្រប់គ្រង? គាត់នឹងបាត់សិទ្ធិទាំងអស់។`,
            () => run('remove', 'teamRemove', { userId: admin.userId }).then((ok) => ok && onBack()))}>
          🗑 លុបអ្នកគ្រប់គ្រង
        </button>
      )}
    </main>
  );
}
