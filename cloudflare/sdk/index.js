// Telegram Serverless's `sdk` on Cloudflare Workers: the Bot API over HTTPS
// with the BOT_TOKEN secret, global fetch, and db on D1 (./db.js). Same
// surface as dev/sdk/index.js; bindEnv(env) is called by the Worker before
// each request (the token and D1 come from the Worker's env, not process.env).

import { bindDb, dbStats } from './db.js';

export { db } from './db.js';

/** Per update: Bot API calls, D1 queries and other fetches (count, ms), for the Worker's log line. */
export const apiStats = { n: 0, ms: 0 };
const fetchStats = { n: 0, ms: 0 };
export function takeStats() {
  const out = { api: { ...apiStats }, db: { ...dbStats }, fetch: { ...fetchStats } };
  for (const s of [apiStats, dbStats, fetchStats]) { s.n = 0; s.ms = 0; }
  return out;
}

let botToken = '';
let apiBase = 'https://api.telegram.org';
let browser = null;

/** The Worker's env for this request: BOT_TOKEN (secret), DB (D1), and TELEGRAM_API for tests. */
export function bindEnv(env) {
  botToken = env.BOT_TOKEN ?? '';
  apiBase = env.TELEGRAM_API || 'https://api.telegram.org';
  browser = env.BROWSER ?? null;
  // A D1 session per request: with read replication on, its reads go to the
  // nearest copy (the webhook runs near Telegram, in Europe; the Mini App near
  // its users) and writes to the primary, in order within the request. With
  // replication off it is the primary, as before.
  bindDb(env.DB?.withSession ? env.DB.withSession('first-unconstrained') : env.DB);
}

export class BotApiError extends Error {
  constructor(method, body) {
    super(`${method}: ${body.description}`);
    this.method = method;
    this.code = body.error_code;
    this.description = body.description;
    this.parameters = body.parameters;
  }
}

/** A file to upload (bytes + name), as on the platform. */
export class InputFile {
  constructor(bytes, name, { type = 'application/octet-stream' } = {}) {
    this.bytes = bytes;
    this.name = name;
    this.type = type;
  }
}

export async function callApi(method, params = {}) {
  if (!botToken) throw new Error('BOT_TOKEN is not set (wrangler secret put BOT_TOKEN)');
  // Top-level InputFile params go up as multipart.
  const hasFile = Object.values(params).some((v) => v instanceof InputFile);
  let init;
  if (hasFile) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (v instanceof InputFile) form.append(k, new Blob([v.bytes], { type: v.type }), v.name);
      else form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    init = { method: 'POST', body: form };
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) };
  }
  const started = Date.now();
  const res = await fetch(`${apiBase}/bot${botToken}/${method}`, init);
  const body = await res.json();
  apiStats.n += 1;
  apiStats.ms += Date.now() - started;
  if (!body.ok) throw new BotApiError(method, body);
  return body.result;
}

/** A file's bytes by file_id, like the platform's api.getFileContent (getFile, then the download URL). */
async function getFileContent(fileId) {
  const file = await callApi('getFile', { file_id: fileId });
  const res = await fetch(`${apiBase}/file/bot${botToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`getFileContent: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** api.<anyMethod>(params) → unwrapped result, like the platform's api (plus getFileContent). */
export const api = new Proxy({}, {
  get: (_, method) => (method === 'getFileContent' ? getFileContent : (params) => callApi(method, params)),
});

const fetchWithHelpers = async (...args) => {
  const started = Date.now();
  try {
    return await globalThis.fetch(...args);
  } finally {
    fetchStats.n += 1;
    fetchStats.ms += Date.now() - started;
  }
};
export { fetchWithHelpers as fetch };

export class EndpointError extends Error {
  constructor(description, parameters) {
    super(description);
    this.parameters = parameters;
  }
}

/**
 * A PNG of an HTML page (Cloudflare Browser Rendering's screenshot, via the
 * BROWSER binding): `selector` is the element captured, `width` the page width.
 * The free plan takes one every 10 seconds, so a refusal is retried a couple
 * of times.
 */
export async function renderImage(html, { width = 1200, selector } = {}) {
  if (!browser?.quickAction) throw new Error('Image rendering isn’t set up (the BROWSER binding in wrangler.jsonc).');
  for (let attempt = 0; ; attempt++) {
    const res = await browser.quickAction('screenshot', {
      html,
      viewport: { width, height: 900, deviceScaleFactor: 2 },
      // A selector captures just that element (it can't be combined with fullPage).
      screenshotOptions: selector ? { type: 'png' } : { type: 'png', fullPage: true },
      gotoOptions: { waitUntil: 'networkidle0', timeout: 20000 },
      ...(selector ? { selector } : {}),
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const text = await res.text().catch(() => '');
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`screenshot: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}
