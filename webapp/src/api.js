// Calls the bot's endpoints (tgcloud/endpoints/<name>.js).
//
// Inside Telegram, Telegram.WebApp.Serverless.call sends the signed init data
// and the platform verifies it. Locally (npm run dev in the project root),
// dev/run.js serves POST /api/<name> and verifies the same init data itself.

const tg = window.Telegram?.WebApp;

export class ApiError extends Error {
  constructor(message, type, parameters) {
    super(message);
    this.type = type;
    this.parameters = parameters ?? {};
  }
}

// Serverless.call reaches the platform's endpoints, so it's only used when the app
// is hosted there; telegram-web-app.js defines it everywhere, even outside Telegram.
const onPlatform = /\.tgcloud\.ai$/.test(window.location.hostname);

export function call(name, input = {}) {
  if (onPlatform && tg?.Serverless?.call) {
    return new Promise((resolve, reject) => {
      tg.Serverless.call(name, input, (err, result) => (err ? reject(new ApiError(err.message, err.type, err.parameters)) : resolve(result)));
    });
  }
  return fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': tg?.initData ?? '' },
    body: JSON.stringify(input),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new ApiError(body.description ?? `HTTP ${res.status}`, body.error_type ?? 'HTTP', body.parameters);
    return body.result;
  });
}
