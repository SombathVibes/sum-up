# sumup

A Telegram bot that adds up the payments posted by bank bots (ABA, ACLEDA, WING) in a group and shows daily, weekly and monthly reports in Khmer.

It runs on [Telegram Serverless](https://core.telegram.org/bots/serverless), so there's no server or Docker to manage.

- **Live:** with [Bot-to-Bot Communication Mode](https://core.telegram.org/bots/features#bot-to-bot-communication) on and admin rights in the group, the bot receives each bank-bot payment as it's posted and stores it. Reports are plain database queries.
- **Catch-up and backfill:** bots can't read chat history, so a small **sync helper** on Cloudflare Workers reads it with a Telegram user account. `/sync` uses it to load past payments and to recover anything missed while the bot was down (Telegram only queues updates for 24 hours). A report's 🔄 button uses it to catch up.

```
bank bot ──payment──▶ Telegram Serverless bot (tgcloud/) ──▶ built-in SQLite
group ────/menu────▶        │
admin ── private chat ─▶    └── /sync, 🔄 ──fetch──▶ sync helper (sync-helper/) ──MTProto──▶ Telegram (user account)
```

A payment can arrive both live and through the helper. In basic groups each account numbers messages separately, so copies are matched on bank bot + time + text (`uq_messages_payment`), not on message id.

## Commands

| Command | Who | What |
|---|---|---|
| `/menu` | anyone, in a group with access | The report menu (below). The first line shows when access ends. Managers also get a ⚙️ Sync row. Menus are rebuilt for whoever taps. |
| `/sync` | managers of the group, super admins | Register the group (1-month trial), re-sync today / this week / this year, Renew, History, and (super admins) Lifetime |
| `/start`, `/menu`, `/admin` in a private chat | admins | The **admin panel** (below). For everyone else a private chat only answers `/start`, `/terms` and `/paysupport`. |
| `/setqr` | super admins, as the caption of a photo | Sets the payment QR shown on ⭐ ការជាវ |
| `/terms` | anyone | Subscription terms (`TERMS_TEXT` in config) |
| `/paysupport` | anyone | Payment help (Telegram requires it for bots that sell with Stars) |

## Reports

- **Day:** a compact table per bank (payments, KHR, USD) with a total. 🗂 កាត switches to cards: a block per bank with its time span, and the latest 10 payments in a collapsible quote. Both end with the change versus yesterday and versus the same weekday last week.
- **Week:** a row per day; **month:** a row per week, with 📆 ប្រចាំថ្ងៃ for a row per day. Under the table: a line per bank, the busiest day, days with payments and the average per day (month), and the change versus the previous period. When a period has more than one bank, buttons filter it to one.
- **Picking a period:** quick buttons (today, yesterday, this/last week, this/last month), a **📅 calendar** for any day (payment days marked •, future days greyed out), and a **📅 year view** for any month.
- Every report has 🔄 (catch up through the sync helper, then redraw) and ⬅️. View options (format, bank filter, daily rows) ride in the button data (`~c`, `~d`, `~b<bank id>`), so 🔄 keeps them.

## Admin panel (private chat)

- Lists the groups this admin may see (all of them for super admins), 10 per page, with days left: `📅 30d`, `⚠️ 2d` (10 days or less), `⛔` expired, `♾️` lifetime. The 5 most urgent are listed on top, and ⚠️ ផុតកំណត់ pages through all of them.
- Tapping a group opens its report menu and, for managers, Sync, Renew and History, without opening the group. Reports there start with the group's name, linked to the group when Telegram allows it. Buttons carry the group as `@<group id>:<data>`, and every action checks the user's role in that group.
- Super admins also get **👥 អ្នកគ្រប់គ្រង** (see Roles).

## Roles

| Role | Who | Can do |
|---|---|---|
| Super admin | `admins.is_super`; `ADMIN_IDS` in config are always super | everything: all groups, Lifetime, `/setqr`, and managing admins |
| Manager of a group | added by a super admin | that group's reports, Sync, Renew and History, in the group and in their private panel |
| Viewer of a group | added by a super admin | that group's reports in their private panel |
| everyone else | | the group's reports |

- A super admin opens the panel → **👥 អ្នកគ្រប់គ្រង** → **➕ បន្ថែម** and picks the person with Telegram's user picker (`request_users`). On that person's page, tapping a group cycles **— → 👁 view → 🛠 manage**, and **⭐ Super admin** makes them super. Names in the list link to their profiles. The list and each admin's groups are paged.
- `ADMIN_IDS` are copied into `admins` as super admins (`added_by` 0) when the team list opens. They can't be demoted or removed from the bot, and a copied row stops counting once its id leaves `ADMIN_IDS`.
- Managers also get `/sync` in that group's command list. New admins have to press Start in a private chat with the bot before it can show them anything.

## Billing: monthly per group

`BILLING_MODE` in `tgcloud/lib/config.js` picks how groups pay. It's `'manual'` by default.

### Manual

- **⭐ ការជាវ** in `/menu` (shown when access ends within 10 days, and on `/menu` in an expired or unregistered group) shows the end date, the price (`MONTHLY_PRICE_CENTS`, `MANUAL_CURRENCY`), the bank, account name and number (`PAYMENT_BANK`, `PAYMENT_ACCOUNT_NAME`, `PAYMENT_ACCOUNT_NUMBER`, with a copy button), `PAYMENT_INSTRUCTIONS`, and a button for sending the receipt.
- **Payment QR:** a super admin sends the QR image to the bot as a photo with the caption `/setqr`. The bot keeps Telegram's file id in the `settings` table, and the screen becomes that photo with the details as its caption.
- After the customer pays, a manager opens `/sync` → **🔄 Renew** and picks **1, 3, 6 or 12 months**. That adds a period after the current one (or from today if it has ended), with the amount and who recorded it, and tells the group. **🧾 History** lists the last 10 periods.
- **♾️ Lifetime** (super admins) gives a group permanent access: no expiry and no ⭐ ការជាវ.
- `/menu` warns when 3 days or less are left.

### Telegram Stars (off by default)

Set `BILLING_MODE = 'stars'` to sell in-app. Telegram requires Stars (`XTR`) for digital services, and its subscriptions renew every 30 days.

- **⭐ ការជាវ** shows a **Subscribe** link: a `createInvoiceLink` subscription whose payload is `sub:<group id>`, so whoever pays pays for that group.
- `handlers/pre_checkout_query.js` approves the checkout. `successful_payment` (in `handlers/message.js`) adds a period for the first payment and each renewal. `handlers/subscription.js` records cancellations, re-enables and failed renewals.
- `charge_id` is unique, so a payment delivered twice counts once, and it's what `refundStarPayment` needs. The price is `SUBSCRIPTION_STARS`.
- Test in Telegram's [test environment](https://core.telegram.org/bots/features#testing-your-bot) to avoid spending real Stars.

Either way, `subscriptions` keeps one row per period (`source` trial / manual / stars, price, currency, payer or recording admin), so it's the payment history.

## Layout

```
tgcloud/                 deployed to Telegram Serverless
  schema.js              groups, subscriptions, messages, settings, admins, admin_groups
  handlers/
    message.js           bank-bot payments, Stars payments, commands, user picker
    callback_query.js    every button, in groups and in the private panel
    pre_checkout_query.js, subscription.js   Stars subscriptions
  lib/
    report.js, ui.js     report text and keyboards
    store.js, roles.js   database access, who may do what
    admin.js             private admin panel and team screens
    billing.js, sync.js  subscriptions, sync helper client
    dates.js, parse.js, telegram.js
sync-helper/             Cloudflare Worker that reads group history (mtcute)
dev/                     local runner with a stand-in for the platform sdk
config.example.js        template for tgcloud/lib/config.js (git-ignored)
test/                    tests for the pure logic (npm test)
```

## Setup

### 1. Sync helper (Cloudflare Worker)

You need an `api_id` and `api_hash` from https://my.telegram.org. The user account you log in with must be a **member of every group** you want reports for.

```bash
cd sync-helper
npm install
```

Log in the user account. This saves `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` and a random `SYNC_SECRET` to `sync-helper/.dev.vars`, which git ignores:

```bash
TG_API_ID=... TG_API_HASH=... npm run login
```

If you have a GramJS session that still works, pass `TG_GRAMJS_SESSION=...` to convert it instead of logging in.

Deploy, then upload the secrets:

```bash
npx wrangler login
npm run deploy
npx wrangler secret bulk .dev.vars
```

Note the `https://sumup-sync.<you>.workers.dev` URL it prints.

### 2. Bot (Telegram Serverless)

1. In @BotFather, open your bot → **Serverless** and turn it on. Then copy the CLI access token from **CLI Access**.
2. Configure and deploy:

   ```bash
   npm install
   cp config.example.js tgcloud/lib/config.js   # set SYNC_HELPER_URL, ADMIN_IDS, payment details, and SYNC_HELPER_SECRET = SYNC_SECRET from .dev.vars
   npx tgcloud login
   npx tgcloud push
   npx tgcloud migrate
   ```

3. In @BotFather, turn on **Bot-to-Bot Communication Mode** for the bot.
4. Add the bot to a group and make it an **admin** (or turn its privacy mode off). Then run `/sync` → **Sync only group** to register the group and start the trial, and **Sync this year** to load past payments. From then on, payments are saved as they arrive.

`tgcloud/lib/config.js` is git-ignored but still deployed by `tgcloud push`, so secrets and payment details stay out of git.

## Development

### Run the bot locally

`dev/run.js` runs the same `tgcloud/` handlers on your machine, with long polling, a local SQLite file (`dev/local.db`, created and migrated on start) and the real sync helper:

```bash
echo 'BOT_TOKEN=123456:ABC...' > .env.local   # from @BotFather; git-ignored
npm run dev
```

The `sdk` stand-in in `dev/sdk/` covers only what this project uses, so test on the real platform before relying on it. A bot can't use long polling while it has a webhook set; the runner tells you and only deletes the webhook with `npm run dev -- --delete-webhook`. Run one copy at a time: two pollers on one token take each other's updates.

### Tests and platform tools

```bash
npm test                                                          # dates, parsing, reports, keyboards
npx tgcloud run handlers/message '{ chat: { id: -100123 }, from: { id: 1 }, text: "/start" }'
npx tgcloud status                                                # what would be deployed
```
