// Telegram Serverless's `sdk` on Cloudflare Workers: the Bot API over HTTPS
// with the BOT_TOKEN secret, global fetch, and db on D1 (./db.js). Same
// surface as dev/sdk/index.js; bindEnv(env) is called by the Worker before
// each request (the token and D1 come from the Worker's env, not process.env).

import { bindDb } from './db.js';

export { db } from './db.js';

let botToken = '';
let apiBase = 'https://api.telegram.org';

/** The Worker's env for this request: BOT_TOKEN (secret), DB (D1), and TELEGRAM_API for tests. */
export function bindEnv(env) {
  botToken = env.BOT_TOKEN ?? '';
  apiBase = env.TELEGRAM_API || 'https://api.telegram.org';
  bindDb(env.DB);
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
  const res = await fetch(`${apiBase}/bot${botToken}/${method}`, init);
  const body = await res.json();
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

const fetchWithHelpers = (...args) => globalThis.fetch(...args);
export { fetchWithHelpers as fetch };

export class EndpointError extends Error {
  constructor(description, parameters) {
    super(description);
    this.parameters = parameters;
  }
}
