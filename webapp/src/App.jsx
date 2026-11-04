// SumUp admin Mini App: Groups (search, expiry, 30-day chart), a group's report
// (date range, banks, payments, CSV), Billing (expiring groups, history, renew)
// and, for super admins, Team (roles per group) and Settings (payment details).
// Who may see what is decided by the endpoints (tgcloud/lib/endpoint.js).

import { useCallback, useEffect, useState } from 'react';
import { call } from './api.js';
import Billing from './screens/Billing.jsx';
import Group from './screens/Group.jsx';
import Groups from './screens/Groups.jsx';
import Settings from './screens/Settings.jsx';
import Team from './screens/Team.jsx';

const tg = window.Telegram?.WebApp;

export default function App() {
  const [me, setMe] = useState(null);
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('groups');
  const [open, setOpen] = useState(null); // { tgId, view: 'report' | 'billing' }

  const load = useCallback(() => {
    setError(null);
    Promise.all([call('me'), call('groups')])
      .then(([m, g]) => { setMe(m); setGroups(g.groups); })
      .catch((e) => setError(e));
  }, []);
  useEffect(load, [load]);

  // Telegram's own Back button closes an opened group.
  useEffect(() => {
    if (!tg?.BackButton) return undefined;
    const back = () => setOpen(null);
    if (open) { tg.BackButton.show(); tg.BackButton.onClick(back); } else tg.BackButton.hide();
    return () => tg.BackButton.offClick(back);
  }, [open]);

  if (error) {
    return (
      <div className="center">
        <p className="big">🔒</p>
        <p>{error.parameters?.code === 'NO_USER' || error.type === 'UNAUTHORIZED' ? 'សូមបើកពី @SumUpsBot ក្នុង Telegram។' : error.message}</p>
        <button className="btn" onClick={load}>ព្យាយាមម្ដងទៀត</button>
      </div>
    );
  }
  if (!groups) return <div className="center muted">កំពុងផ្ទុក…</div>;

  const group = open && groups.find((g) => g.tgId === open.tgId);
  if (group) {
    return <Group group={group} startView={open.view} onClose={() => setOpen(null)} onChanged={load} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="grow">
          <div className="title">SumUp Admin</div>
          <div className="muted small">{me?.name}{me?.superAdmin ? ' · ⭐ Super admin' : ''}</div>
        </div>
        <button className="icon" onClick={load} aria-label="Refresh">🔄</button>
      </header>
      {tab === 'groups' && <Groups groups={groups} onOpen={(tgId) => setOpen({ tgId, view: 'report' })} />}
      {tab === 'billing' && <Billing groups={groups} onOpen={(tgId) => setOpen({ tgId, view: 'billing' })} />}
      {tab === 'team' && me?.superAdmin && <Team me={me} />}
      {tab === 'settings' && me?.superAdmin && <Settings />}
      <nav className="tabs">
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>🏪 ក្រុម</button>
        <button className={tab === 'billing' ? 'on' : ''} onClick={() => setTab('billing')}>
          ⭐ ការជាវ{(() => { const n = groups.filter((g) => !g.status || (g.status.kind !== 'lifetime' && g.status.daysLeft <= 10)).length; return n ? <span className="dot">{n}</span> : null; })()}
        </button>
        {me?.superAdmin && (
          <>
            <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>👥 ក្រុមការងារ</button>
            <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️ ការកំណត់</button>
          </>
        )}
      </nav>
    </div>
  );
}
