// Tries the Daily report login the way the bot does (POST JSON { username,
// password } with an optional Basic header) and says whether it worked,
// without printing the token. Asks for the password without echoing it.
//
//   node dev/try-login.mjs <login url> [basic value] ['Name: value']…

import { createInterface } from 'node:readline';

const [url, basic, ...extra] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node dev/try-login.mjs <login url> [basic value] ['Name: value']…");
  process.exit(1);
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const username = await ask('Username: ');
const password = await ask('Password (hidden): ', true);

const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
for (const h of extra) headers[h.slice(0, h.indexOf(':')).trim()] = h.slice(h.indexOf(':') + 1).trim();
if (basic) headers.Authorization = `Basic ${basic.replace(/^Basic\s+/i, '')}`;
const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ username, password }) });
const text = await res.text();
let data = null;
try {
  data = JSON.parse(text);
} catch {
  // not JSON
}

const pick = (o, p) => p.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const field = ['token', 'access_token', 'accessToken', 'jwt', 'id_token', 'data.token', 'data.access_token', 'data.accessToken', 'data.jwt', 'result.token', 'result.access_token']
  .find((p) => typeof pick(data, p) === 'string' && pick(data, p));

console.log(`HTTP ${res.status}`);
if (res.ok && field) console.log(`✅ Login works. Token found in "${field}" (${pick(data, field).length} characters, not shown).`);
else if (res.ok) console.log(`⚠️ Login OK but no token field found. Reply fields: ${Object.keys(data ?? {}).join(', ') || '(not JSON)'}`);
else console.log(`❌ ${data?.message ?? data?.error_description ?? data?.error ?? text.slice(0, 200)}`);
