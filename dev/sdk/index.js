// Local stand-in for Telegram Serverless's `sdk`: the Bot API over HTTPS with
// BOT_TOKEN, global fetch, and the node:sqlite-backed db from ./db.js.

export { db } from './db.js';

const API_BASE = process.env.TELEGRAM_API ?? 'https://api.telegram.org';

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
  // Top-level InputFile params go up as multipart (nested ones, e.g. in media groups, aren't needed here).
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
  const res = await fetch(`${API_BASE}/bot${process.env.BOT_TOKEN}/${method}`, init);
  const body = await res.json();
  if (!body.ok) throw new BotApiError(method, body);
  return body.result;
}

/** A file's bytes by file_id, like the platform's api.getFileContent (getFile, then the download URL). */
async function getFileContent(fileId) {
  const file = await callApi('getFile', { file_id: fileId });
  const res = await fetch(`${API_BASE}/file/bot${process.env.BOT_TOKEN}/${file.file_path}`);
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

/** On Cloudflare, Browser Rendering's screenshot (cloudflare/sdk); not available locally. */
export async function renderImage() {
  throw new Error('Images are made on Cloudflare only (Browser Rendering).');
}
