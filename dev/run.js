// Runs the tgcloud/ handlers on this machine with long polling, for testing
// before Telegram Serverless is available. Usage:
//
//   BOT_TOKEN=123:abc npm run dev        (or put BOT_TOKEN in .env.local)
//
// Data goes to dev/local.db. Reports still call the real sync helper from
// tgcloud/lib/config.js. The admin Mini App is served on http://localhost:8790
// (see dev/miniapp.js); build it first with `npm run build`.

import { registerHooks } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const here = new URL('./', import.meta.url);
const SDK = {
  sdk: new URL('sdk/index.js', here).href,
  'sdk/api': new URL('sdk/index.js', here).href,
  'sdk/fetch': new URL('sdk/index.js', here).href,
  'sdk/db': new URL('sdk/db.js', here).href,
};
registerHooks({
  resolve: (specifier, context, next) =>
    SDK[specifier] ? { url: SDK[specifier], shortCircuit: true, format: 'module' } : next(specifier, context),
});

const root = new URL('../tgcloud/', import.meta.url);
if (!existsSync(new URL('lib/config.js', root))) {
  console.error('Missing tgcloud/lib/config.js — copy config.example.js there first.');
  process.exit(1);
}
if (!process.env.BOT_TOKEN) {
  console.error('Set BOT_TOKEN (e.g. in .env.local): the token from @BotFather.');
  process.exit(1);
}

const { open } = await import(SDK['sdk/db']);
const { callApi, EndpointError } = await import(SDK.sdk);
const dbFile = process.env.DEV_DB ?? new URL('local.db', here).pathname;
open(dbFile, await import(new URL('schema.js', root).href));

// The admin Mini App and its endpoints (DEV_MINIAPP_PORT=0 turns it off).
const miniAppPort = Number(process.env.DEV_MINIAPP_PORT ?? 8790);
if (miniAppPort) {
  const { startMiniApp } = await import(new URL('miniapp.js', here).href);
  await startMiniApp({ root, port: miniAppPort, botToken: process.env.BOT_TOKEN, EndpointError });
}

const handlers = {};
for (const file of readdirSync(new URL('handlers/', root))) {
  if (!file.endsWith('.js')) continue;
  handlers[file.slice(0, -3)] = (await import(pathToFileURL(new URL(`handlers/${file}`, root).pathname).href)).default;
}

// Long polling and a webhook can't both be active on one bot.
const hook = await callApi('getWebhookInfo');
hook.url = hook.url.replaceAll(process.env.BOT_TOKEN, '<token>'); // webhook paths often embed the token
if (hook.url) {
  if (!process.argv.includes('--delete-webhook')) {
    console.error(`This bot has a webhook set (${hook.url}).`);
    console.error('If nothing else uses it, re-run with: npm run dev -- --delete-webhook');
    process.exit(1);
  }
  await callApi('deleteWebhook');
  console.log('Deleted webhook', hook.url);
}

const me = await callApi('getMe');
console.log(`▶ @${me.username} running locally (${Object.keys(handlers).join(', ')}), db: ${dbFile}`);

// Daily report: on the platform the sync helper's cron sends /dailyrun; here a
// timer runs the same check every minute (DEV_DAILY=0 turns it off).
if (process.env.DEV_DAILY !== '0') {
  const { runDue } = await import(new URL('lib/daily.js', root).href);
  setInterval(() => {
    runDue()
      .then((ran) => ran.forEach(({ group, row }) => console.log(`${row.ok ? '✓' : '✗'} daily report ${group.name ?? group.tgId}: ${row.ok ? `HTTP ${row.httpStatus}` : row.error}`)))
      .catch((e) => console.error('✗ daily report', e));
  }, 60_000);
}

let offset = 0;
for (;;) {
  let updates;
  try {
    updates = await callApi('getUpdates', { offset, timeout: 30, allowed_updates: Object.keys(handlers) });
  } catch (e) {
    console.error('getUpdates failed:', e.message);
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  for (const update of updates) {
    offset = update.update_id + 1;
    const type = Object.keys(update).find((k) => k !== 'update_id');
    const handler = handlers[type];
    if (!handler) continue;
    const started = Date.now();
    try {
      await handler(update[type], { update });
      console.log(`✓ ${type} ${describe(update[type])} (${Date.now() - started} ms)`);
    } catch (e) {
      console.error(`✗ ${type} ${describe(update[type])}`, e);
    }
  }
}

function describe(payload) {
  return payload.text ?? payload.data ?? '';
}
