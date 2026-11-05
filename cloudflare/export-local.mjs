// npm run cf:export — copies the local database (dev/local.db, or DEV_DB) into
// SQL for D1: cloudflare/data.local.sql (git-ignored: it holds the lottery
// logins' passwords and tokens). Then:
//   npx wrangler d1 execute sumup --local  --file cloudflare/data.local.sql   (wrangler dev)
//   npx wrangler d1 execute sumup --remote --file cloudflare/data.local.sql   (the live D1)
// Every table in tgcloud/schema.js, the columns it still has (deprecated ones
// are left out); rows are INSERT OR REPLACE, so running it twice is harmless.

import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const here = new URL('./', import.meta.url);
const sdkDb = new URL('sdk/db.js', here).href;
registerHooks({ resolve: (s, c, n) => (s === 'sdk/db' ? { url: sdkDb, shortCircuit: true, format: 'module' } : n(s, c)) });
const { TABLE } = await import(sdkDb);
const schema = await import(new URL('../tgcloud/schema.js', import.meta.url).href);

const file = process.env.DEV_DB ?? new URL('../dev/local.db', import.meta.url).pathname;
const local = new DatabaseSync(file, { readOnly: true });
const literal = (v) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' || typeof v === 'bigint' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`);

const out = ['-- Written by cloudflare/export-local.mjs from the local database — holds secrets, never commit.'];
const counts = [];
for (const t of Object.values(schema).filter((x) => x?.[TABLE])) {
  const { name, columns } = t[TABLE];
  const have = new Set(local.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name));
  const cols = Object.values(columns).map((c) => c.name).filter((c) => have.has(c));
  if (!cols.length) continue;
  const rows = local.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${name}"`).all();
  for (const r of rows) out.push(`INSERT OR REPLACE INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => literal(r[c])).join(', ')});`);
  counts.push(`${name} ${rows.length}`);
}
writeFileSync(new URL('data.local.sql', here), `${out.join('\n')}\n`);
console.log(`cloudflare/data.local.sql: ${counts.join(' · ')}`);
