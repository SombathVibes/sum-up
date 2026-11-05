// The bot on Cloudflare Workers (until Telegram Serverless is out): the same
// tgcloud/ code, with `sdk` from cloudflare/sdk (Bot API + D1; wrangler.jsonc
// aliases it). One Worker does what the platform does:
//
//   POST /telegram    Telegram's webhook. Checked against WEBHOOK_SECRET (the
//                     X-Telegram-Bot-Api-Secret-Token header), answered at
//                     once; the update is handled in ctx.waitUntil, as
//                     dev/run.js does: handlers[<update type>](payload, { update }).
//   POST /api/<name>  The Mini App's endpoints (tgcloud/endpoints/<name>.js),
//                     with Telegram's signed init data in X-Init-Data, verified
//                     like dev/miniapp.js (HMAC-SHA256 with the bot token, at
//                     most 24 h old). Same JSON replies.
//   POST /setup       Points the bot's webhook here (setWebhook with the
//                     secret and the update types the handlers take). Needs
//                     the same secret, in X-Setup-Key.
//   anything else     The built Mini App (webapp/dist, "assets" in wrangler.jsonc).
//
// Cron (every minute): the lottery logins' schedule (lib/schedule.js runDue)
// and yesterday's agent days (collectYesterday), as dev/run.js's timer does;
// on Telegram Serverless the sync helper sends /dailyrun for this.
//
// Secrets: BOT_TOKEN and WEBHOOK_SECRET (wrangler secret put …). D1: DB.

import { bindEnv, callApi, EndpointError } from 'sdk';
import { endpoints, handlers } from './generated.js';
import { collectYesterday } from '../tgcloud/lib/agents.js';
import { listLogins } from '../tgcloud/lib/logins.js';
import { runDue } from '../tgcloud/lib/schedule.js';

const MAX_AGE = 24 * 3600;
// Update types the Bot API sends (a handler for anything else never gets called here).
const BOT_API_UPDATES = new Set(['message', 'edited_message', 'callback_query', 'pre_checkout_query', 'my_chat_member', 'chat_member', 'inline_query']);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time string compare (secrets). */
function same(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  if (x.length !== y.length || !x.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const hmac = async (key, data) => {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
};
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Telegram Mini App init data → { user, … }, or null when it doesn't verify. */
async function verifyInitData(raw, botToken) {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !botToken) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (!same(hex(await hmac(secret, check)), hash)) return null;
  if (Math.floor(Date.now() / 1000) - Number(params.get('auth_date')) > MAX_AGE) return null;
  const data = Object.fromEntries(params);
  for (const k of ['user', 'receiver', 'chat']) if (data[k]) data[k] = JSON.parse(data[k]);
  return data;
}

/** One webhook update, as dev/run.js handles a polled one. */
async function dispatch(update) {
  const type = Object.keys(update).find((k) => k !== 'update_id');
  const handler = handlers[type];
  if (!handler) return;
  const started = Date.now();
  try {
    await handler(update[type], { update });
    console.log(`✓ ${type} ${update[type]?.text ?? update[type]?.data ?? ''} (${Date.now() - started} ms)`);
  } catch (e) {
    console.error(`✗ ${type}`, e?.stack ?? e);
  }
}

async function api(name, request, env) {
  const fn = endpoints[name];
  if (!fn) return json(404, { ok: false, error_type: 'NOT_FOUND', description: 'No such endpoint' });
  const initData = await verifyInitData(request.headers.get('X-Init-Data') ?? '', env.BOT_TOKEN);
  if (!initData) return json(401, { ok: false, error_type: 'UNAUTHORIZED', description: 'Invalid init data' });
  let input;
  try {
    const text = await request.text();
    input = text ? JSON.parse(text) : {};
  } catch {
    return json(400, { ok: false, error_type: 'BAD_REQUEST', description: 'Body must be JSON' });
  }
  try {
    return json(200, { ok: true, result: await fn(input, { initData }) });
  } catch (e) {
    if (e instanceof EndpointError) return json(400, { ok: false, error_type: 'ENDPOINT_ERROR', description: e.message, parameters: e.parameters ?? {} });
    console.error(`✗ api/${name}`, e?.stack ?? e);
    return json(500, { ok: false, error_type: 'INTERNAL', description: 'Internal error' });
  }
}

export default {
  async fetch(request, env, ctx) {
    bindEnv(env);
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/telegram') {
      if (!same(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.WEBHOOK_SECRET)) return new Response('forbidden', { status: 403 });
      const update = await request.json().catch(() => null);
      // Answered at once, so Telegram doesn't retry; the work goes on in the background.
      if (update) ctx.waitUntil(dispatch(update));
      return new Response('ok');
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) return api(url.pathname.slice(5), request, env);
    if (request.method === 'POST' && url.pathname === '/setup') {
      if (!same(request.headers.get('X-Setup-Key'), env.WEBHOOK_SECRET)) return new Response('forbidden', { status: 403 });
      const hook = `${url.origin}/telegram`;
      // Only Bot API update types (handlers/subscription.js is a Telegram Serverless event).
      const allowed = Object.keys(handlers).filter((t) => BOT_API_UPDATES.has(t));
      await callApi('setWebhook', { url: hook, secret_token: env.WEBHOOK_SECRET, allowed_updates: allowed, drop_pending_updates: false });
      const info = await callApi('getWebhookInfo');
      return json(200, { ok: true, webhook: info.url, pending: info.pending_update_count, allowed_updates: info.allowed_updates });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    bindEnv(env);
    ctx.waitUntil((async () => {
      try {
        const ran = await runDue();
        for (const { login, reports, totalsError } of ran) {
          const failed = reports.filter((r) => !r.ok).length;
          console.log(`${failed || totalsError ? '✗' : '✓'} lottery login ${login.username}: ${reports.length - failed}/${reports.length} reports${totalsError ? ` · totals: ${totalsError}` : ''}`);
        }
        const logins = (await listLogins({ secret: true })).filter((l) => l.enabled && l.baseUrl);
        await collectYesterday(logins);
        console.log(`✓ scheduled (${event.cron}): ${ran.length} login run(s) due, ${logins.length} enabled login(s)`);
      } catch (e) {
        console.error('✗ scheduled', e?.stack ?? e);
      }
    })());
  },
};
