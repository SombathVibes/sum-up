// A card that folds: its header shows a title and a one-line summary of what's
// set; tap it to open. Starts closed unless `start`.

import { useState } from 'react';

export default function Fold({ title, summary, start = false, children }) {
  const [open, setOpen] = useState(start);
  return (
    <details className="card fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <strong>{title}</strong>
        {summary && <div className="small muted">{summary}</div>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
