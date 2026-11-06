# The bot on Cloudflare Workers

This branch (`cloudflare`) runs the same bot on Cloudflare until Telegram
Serverless is released. `main` stays as it is for Telegram Serverless; merge
`main` into this branch to bring bot changes over (then `npm run cf:gen`).

Nothing under `tgcloud/` changes: the bot only talks to the platform through
`sdk`, which `wrangler.jsonc` points at `cloudflare/sdk/` (the Bot API with the
`BOT_TOKEN` secret, and `sdk/db` on D1 — the same query code as `dev/sdk/`).

| | |
|---|---|
| `cloudflare/worker.js` | `POST /telegram` (the webhook, checked against `WEBHOOK_SECRET`, handled in the background), `POST /api/<name>` (the Mini App's endpoints, with Telegram's signed init data), `POST /setup` (sets the webhook), the Mini App itself, and a cron every minute (the lottery logins' schedule and yesterday's agent days). |
| `cloudflare/sdk/` | `sdk` and `sdk/db` for Workers. |
| `cloudflare/gen.mjs` | `npm run cf:gen`: the handler/endpoint list (`generated.js`) and the tables (`schema.sql`, first migration). |
| `cloudflare/migrations/` | D1 migrations, applied once each. |
| `cloudflare/export-local.mjs` | `npm run cf:export`: your local database as SQL, to load into D1. |

## First deploy

You run these; they use your Cloudflare account and the bot's token.

1. **Log in:** `npx wrangler login`.
2. **Plan:** Workers Paid ($5/month) is recommended — the free plan allows
   10 ms of CPU per request, and building an agent Excel or a month of report
   pages needs more. D1 fits in the free tier.
3. **Database:** `npx wrangler d1 create sumup-eu --location weur` (Western
   Europe, next to Telegram's servers — much faster than Asia-Pacific), and put
   the `database_id` it prints into `wrangler.jsonc`.
4. **Secrets** (typed into the prompt, never into a file):
   - `npx wrangler secret put BOT_TOKEN` — the token from @BotFather.
   - `npx wrangler secret put WEBHOOK_SECRET` — any long random string (letters,
     digits, `_` or `-`; e.g. from `openssl rand -hex 32`). Telegram sends it
     with every update, and `/setup` asks for it.
5. **Config:** `tgcloud/lib/config.js` (not in git) is bundled from your
   machine. Set `MINIAPP_URL` to the Worker's address once you know it (step 7),
   e.g. `https://sumup-bot.<your-subdomain>.workers.dev`, and deploy again.
6. **Deploy:** `npm run cf:deploy` — generates, builds the Mini App, applies the
   D1 migrations, deploys.
7. **Data (optional):** `npm run cf:export`, then
   `npx wrangler d1 execute sumup-eu --remote --file cloudflare/data.local.sql`
   copies your local groups, subscriptions, payments, logins and settings in.
   The file holds the lottery logins' passwords; it's git-ignored — delete it
   afterwards.
8. **Webhook:** this moves the bot onto the Worker.
   `curl -X POST https://<worker>/setup -H "X-Setup-Key: <WEBHOOK_SECRET>"`
   answers with the webhook it set.
9. **Mini App button:** in @BotFather → your bot → Bot Settings → Configure
   Mini App, set the Worker's address.

## Afterwards

- **Deploy again:** `npm run cf:deploy`.
- **Logs:** `npx wrangler tail`, or Workers → sumup-bot → Logs in the dashboard.
- **New table or column in `schema.js`:** add a migration, e.g.
  `cloudflare/migrations/0002_<what>.sql` with `ALTER TABLE … ADD COLUMN …;`,
  then deploy (migrations apply first).
- **The sync helper** (`sync-helper/`) is still what `/sync` uses for history.
  Its cron's `/dailyrun` isn't needed here (the Worker's cron does the same);
  if it still sends one, the run is skipped as already done.
- **Local development** (`npm run dev`) uses long polling, which Telegram
  refuses while a webhook is set: use a second test bot locally, or
  `npm run dev -- --delete-webhook` and run `/setup` again after.
- **Locally on Workers:** `npm run cf:dev` (needs a `.dev.vars` with
  `BOT_TOKEN` and `WEBHOOK_SECRET`; it's git-ignored).

## Back to Telegram Serverless

Deploy `main` with `npm run deploy` (it sets its own webhook), and export the
data from D1 if you need it (`npx wrangler d1 export sumup-eu --remote --output …`).
