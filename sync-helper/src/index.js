// Sync helper: reads a group's history as a Telegram *user* account (bots can't
// see other bots' messages) and returns the payment bots' messages to the
// Telegram Serverless bot, which calls POST /history.
//
// Secrets (wrangler secret put …): TG_API_ID, TG_API_HASH, TG_SESSION, SYNC_SECRET.

import { MemoryStorage, TelegramClient, WebCryptoProvider } from '@mtcute/web';
// Bundled by wrangler as a WebAssembly.Module; by default mtcute would fetch() it by URL.
import mtcuteWasm from '@mtcute/wasm/mtcute.wasm';

// Workers can't reuse a socket across requests, so each request gets its own client.
async function openClient(env) {
  const tg = new TelegramClient({
    apiId: Number(env.TG_API_ID),
    apiHash: env.TG_API_HASH,
    storage: new MemoryStorage(),
    crypto: new WebCryptoProvider({ wasmInput: mtcuteWasm }),
  });
  await tg.importSession(env.TG_SESSION);
  await tg.connect();
  return tg;
}

/** A fresh MemoryStorage knows no access hashes; a dialogs pass fills them in. */
async function ensurePeer(tg, chatId) {
  try {
    await tg.resolvePeer(chatId);
    return;
  } catch {
    // not cached yet
  }
  for await (const dialog of tg.iterDialogs()) {
    if (dialog.peer.id === chatId) break;
  }
  await tg.resolvePeer(chatId);
}

/**
 * Body: { chatId, minId?, since?, until?, senders: number[] }
 * Reads newest → oldest and stops at minId or since, whichever comes first.
 * Returns { messages: [{ id, date, senderId, text }], maxId }.
 */
async function history(tg, { chatId, minId = 0, since = 0, until, senders }) {
  await ensurePeer(tg, chatId);
  const wanted = new Set(senders);
  const messages = [];
  let maxId = 0;

  const params = { minId };
  if (until) params.offset = { id: 0, date: until + 1 };

  for await (const msg of tg.iterHistory(chatId, params)) {
    const date = Math.floor(msg.date.getTime() / 1000);
    if (msg.id <= minId || date < since) break;
    maxId = Math.max(maxId, msg.id);
    if (until && date > until) continue;
    if (!wanted.has(msg.sender.id) || !msg.text) continue;
    messages.push({ id: msg.id, date, senderId: msg.sender.id, text: msg.text });
  }

  return { messages, maxId };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (request.method !== 'POST' || url.pathname !== '/history') return json({ error: 'not found' }, 404);
    if (request.headers.get('Authorization') !== `Bearer ${env.SYNC_SECRET}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    if (!Number.isSafeInteger(body.chatId) || !Array.isArray(body.senders)) {
      return json({ error: 'chatId and senders are required' }, 400);
    }

    let tg;
    try {
      tg = await openClient(env);
      return json(await history(tg, body));
    } catch (e) {
      console.error(e);
      return json({ error: String(e?.message ?? e) }, 502);
    } finally {
      await tg?.destroy().catch(() => {});
    }
  },
};
