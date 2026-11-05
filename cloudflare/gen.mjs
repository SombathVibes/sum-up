// npm run cf:gen — writes what the Worker can't work out at runtime (it has no
// file system):
//   cloudflare/generated.js     imports of every tgcloud/handlers/*.js and
//                               tgcloud/endpoints/*.js
//   cloudflare/schema.sql       CREATE TABLE / INDEX for every table in
//                               tgcloud/schema.js (IF NOT EXISTS), via
//                               cloudflare/sdk/db.js ddl()
//   cloudflare/migrations/0001_init.sql
//                               the first D1 migration, if there's none yet
// Run it after merging bot changes from main. When schema.js gains a table
// or column later, add a new migration (e.g. 0002_<what>.sql with ALTER
// TABLE … ADD COLUMN …): D1 applies each migration once.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const here = new URL('./', import.meta.url);
const root = new URL('../tgcloud/', import.meta.url);
const sdkDb = new URL('sdk/db.js', here).href;
registerHooks({ resolve: (s, c, n) => (s === 'sdk/db' ? { url: sdkDb, shortCircuit: true, format: 'module' } : n(s, c)) });

// 1. Handlers and endpoints.
const list = (dir) => readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.js')).sort();
const id = (f) => f.slice(0, -3).replace(/\W/g, '_');
const handlers = list('handlers/');
const endpoints = list('endpoints/');
writeFileSync(new URL('generated.js', here), [
  '// Written by cloudflare/gen.mjs (npm run cf:gen) — do not edit.',
  ...handlers.map((f) => `import h_${id(f)} from '../tgcloud/handlers/${f}';`),
  ...endpoints.map((f) => `import e_${id(f)} from '../tgcloud/endpoints/${f}';`),
  '',
  `export const handlers = { ${handlers.map((f) => `${JSON.stringify(f.slice(0, -3))}: h_${id(f)}`).join(', ')} };`,
  `export const endpoints = { ${endpoints.map((f) => `${JSON.stringify(f.slice(0, -3))}: e_${id(f)}`).join(', ')} };`,
  '',
].join('\n'));

// 2. Tables.
const { ddl, TABLE } = await import(sdkDb);
const schema = await import(new URL('schema.js', root).href);
const statements = Object.values(schema).filter((t) => t?.[TABLE]).flatMap((t) => ddl(t)).map((s) => `${s};`);
const sql = ['-- Written by cloudflare/gen.mjs from tgcloud/schema.js — do not edit.', ...statements, ''].join('\n');
writeFileSync(new URL('schema.sql', here), sql);
const migrations = new URL('migrations/', here);
mkdirSync(migrations, { recursive: true });
const first = new URL('0001_init.sql', migrations);
if (!existsSync(first)) writeFileSync(first, sql);

console.log(`cloudflare/generated.js: ${handlers.length} handlers, ${endpoints.length} endpoints`);
console.log(`cloudflare/schema.sql: ${statements.length} statements${existsSync(first) ? '' : ''}`);
