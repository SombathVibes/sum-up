// Serves the admin Mini App locally, as Telegram Serverless would: the built
// front-end (webapp/dist) and POST /api/<name> → tgcloud/endpoints/<name>.js.
//
// Init data is verified the way Telegram documents it (HMAC-SHA256 with the
// bot token, at most 24 hours old), so a tunnel to this server can be opened
// from the bot's 🖥 button in a real Telegram client. For a plain browser,
// DEV_FAKE_USER_ID=<telegram id> stands in for init data — only for requests
// made directly on localhost, never through a tunnel.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const MAX_AGE = 24 * 3600;

function verifyInitData(raw, botToken) {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Math.floor(Date.now() / 1000) - Number(params.get('auth_date')) > MAX_AGE) return null;
  const data = Object.fromEntries(params);
  for (const k of ['user', 'receiver', 'chat']) if (data[k]) data[k] = JSON.parse(data[k]);
  return data;
}

// Directly on this machine: no proxy/tunnel headers and a loopback Host.
const isLocal = (req) => !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip']
  && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');

export async function startMiniApp({ root, port, botToken, EndpointError }) {
  const endpoints = {};
  const dir = new URL('endpoints/', root);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.js')) endpoints[file.slice(0, -3)] = (await import(pathToFileURL(new URL(file, dir).pathname).href)).default;
    }
  }
  const dist = new URL('../webapp/dist/', root).pathname;
  const fakeUser = process.env.DEV_FAKE_USER_ID ? { id: Number(process.env.DEV_FAKE_USER_ID), first_name: 'Dev' } : null;

  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const fn = endpoints[url.pathname.slice(5)];
      if (!fn) return send(res, 404, { ok: false, error_type: 'NOT_FOUND', description: 'No such endpoint' });
      const raw = req.headers['x-init-data'] ?? '';
      // Init data that was sent must verify; the fake user only stands in when none was sent at all.
      let initData = raw ? verifyInitData(raw, botToken) : null;
      if (!raw && fakeUser && isLocal(req)) initData = { user: fakeUser };
      if (!initData) return send(res, 401, { ok: false, error_type: 'UNAUTHORIZED', description: 'Invalid init data' });
      let input = {};
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        input = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { ok: false, error_type: 'BAD_REQUEST', description: 'Body must be JSON' });
      }
      const started = Date.now();
      try {
        const result = await fn(input, { initData });
        console.log(`✓ api/${url.pathname.slice(5)} (${Date.now() - started} ms)`);
        return send(res, 200, { ok: true, result });
      } catch (e) {
        if (e instanceof EndpointError) return send(res, 400, { ok: false, error_type: 'ENDPOINT_ERROR', description: e.message, parameters: e.parameters ?? {} });
        console.error(`✗ api/${url.pathname.slice(5)}`, e);
        return send(res, 500, { ok: false, error_type: 'INTERNAL', description: 'Internal error' });
      }
    }
    // Static files, with index.html for client-side routes (like "spa": true).
    if (!existsSync(dist)) return send(res, 503, 'Build the Mini App first: npm run build', 'text/plain');
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    return send(res, 200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`▶ Mini App on http://localhost:${port} (${Object.keys(endpoints).length} endpoints)${fakeUser ? ` · fake user ${fakeUser.id} for localhost only` : ''}`);
  return server;
}
