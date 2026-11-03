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

export async function callApi(method, params = {}) {
  const res = await fetch(`${API_BASE}/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!body.ok) throw new BotApiError(method, body);
  return body.result;
}

/** api.<anyMethod>(params) → unwrapped result, like the platform's api. */
export const api = new Proxy({}, { get: (_, method) => (params) => callApi(method, params) });

const fetchWithHelpers = (...args) => globalThis.fetch(...args);
export { fetchWithHelpers as fetch };

export class EndpointError extends Error {
  constructor(description, parameters) {
    super(description);
    this.parameters = parameters;
  }
}
