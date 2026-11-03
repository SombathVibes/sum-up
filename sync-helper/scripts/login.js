// Logs in the sync helper's Telegram user account and saves the session as
// TG_SESSION in .dev.vars (git-ignored), next to TG_API_ID / TG_API_HASH.
//
//   TG_API_ID=… TG_API_HASH=… npm run login         # phone + code (+ 2FA)
//   TG_GRAMJS_SESSION=… npm run login               # convert an old GramJS session instead
//
// TG_API_ID / TG_API_HASH may also already be in .dev.vars.

import { convertFromGramjsSession } from '@mtcute/convert';
import { MemoryStorage, TelegramClient } from '@mtcute/node';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const VARS = '.dev.vars';
const vars = Object.fromEntries(
  (existsSync(VARS) ? readFileSync(VARS, 'utf8') : '')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const apiId = process.env.TG_API_ID ?? vars.TG_API_ID;
const apiHash = process.env.TG_API_HASH ?? vars.TG_API_HASH;
if (!apiId || !apiHash) {
  console.error('Set TG_API_ID and TG_API_HASH (from https://my.telegram.org).');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const tg = new TelegramClient({ apiId: Number(apiId), apiHash, storage: new MemoryStorage() });

const gramjs = process.env.TG_GRAMJS_SESSION;
const self = await tg.start({
  session: gramjs ? convertFromGramjsSession(gramjs) : undefined,
  phone: () => rl.question('Phone number (with country code): '),
  code: () => rl.question('Code from Telegram: '),
  password: () => rl.question('2FA password: '),
});

Object.assign(vars, {
  TG_API_ID: apiId,
  TG_API_HASH: apiHash,
  TG_SESSION: await tg.exportSession(),
  SYNC_SECRET: vars.SYNC_SECRET ?? randomBytes(32).toString('hex'),
});
writeFileSync(VARS, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

console.log(`\n✅ Logged in as ${self.displayName}. Saved TG_SESSION to ${VARS}.`);
console.log('Upload the secrets with: npx wrangler secret bulk .dev.vars');

rl.close();
await tg.destroy();
