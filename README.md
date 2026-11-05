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

**How reports look:** the report screens (bank day/week/month, 📥 by-draw, 💰 totals) are Telegram **rich messages** (Bot API 10.1+): real tables with Khmer headers and numbers aligned right, folding sections, and times shown in each reader's own time zone (`<tg-time>`; the 📥 "fetched" time is relative, e.g. "5 minutes ago"). Each screen is built once with `lib/rich.js` (`Doc`), which also gives the ordinary HTML form (monospace tables, expandable quotes); if Telegram refuses a rich edit, `edit()` sends that form instead. Main buttons are coloured (`style`, Bot API 9.4): 📊 / 📥 / 📋 / 💰 blue, 🔄 green.


Laid out like the 📥 lottery report: `/menu` → **📊 របាយការណ៍ធនាគារ** opens a day picker, one tap per day: today, yesterday and five more days (a week per page, ◀ សប្ដាហ៍មុន / សប្ដាហ៍ក្រោយ ▶), • on days with payments, plus **📅 ប្រតិទិន** for any day. **💰 សរុប** picks a week or a month (this/last, or the 📅 year view for any month).

- **Day:** a compact table per bank (payments, KHR, USD) with a total. 🗂 កាត switches to cards: a block per bank with its time span, and the day's payments in a collapsible quote (the latest 100). Both end with the change versus yesterday and versus the same weekday last week.
- **Week:** a row per day; **month:** a row per Monday-to-Sunday week, with 📆 ប្រចាំថ្ងៃ for a row per day. Under the table: a line per bank, the busiest day, days with payments and the average per day (month), and the change versus the previous period. When a period has more than one bank, buttons filter it to one.
- Every report has **◀ ▶** for the period before and after (▶ stops at today), **🔄 ទាញថ្មី** (catch up through the sync helper, then redraw), **📅 ថ្ងៃផ្សេង** (a day) or **📅 រយៈពេលផ្សេង** (a week or month) back to its picker, and ⬅️ to the menu. Buttons name the period absolutely (`DATE_`, `WEEK_<Monday>`, `MONTH_`), so they mean the same period tomorrow. View options (format, daily rows, bank filter) ride in the button data (`~c`, `~d`, `~b<bank id>`), so ◀ ▶ and 🔄 keep them. Buttons on older messages still work: the old daily menu opens the day picker and the weekly/monthly ones the 💰 picker.

## Admin panel (private chat)

- Lists the groups this admin may see (all of them for super admins), 10 per page, with days left: `📅 30d`, `⚠️ 2d` (10 days or less), `⛔` expired, `♾️` lifetime. The 5 most urgent are listed on top, and ⚠️ ផុតកំណត់ pages through all of them.
- Tapping a group opens its report menu and, for managers, Sync, Renew and History, without opening the group. Reports there start with the group's name, linked to the group when Telegram allows it. Buttons carry the group as `@<group id>:<data>`, and every action checks the user's role in that group.
- Super admins also get **👥 អ្នកគ្រប់គ្រង** (see Roles).

## Admin Mini App

A web app inside Telegram for admins (`webapp/`, Vite + React), hosted by Telegram Serverless next to the bot.

- **Groups:** search, filter (all / ending soon / expired), sort by name, days left or 30-day total, and a 30-day chart for each group. A group with the lottery report on also shows its last 30 days as **🎰 win/lose · 📤 សាង · 💵 final result**, from saved figures only (no lottery API call for the list).
- **A group:** any date range (quick buttons or a date picker); when the lottery report is on for the group, a **🎰 របាយការណ៍ឆ្នោត** summary on top: **💵 សរុបចុងក្រោយ** (win/lose less 📤's user share) with how it adds up, then 🎰 and 📤 សាង (bet, payout, profit or loss, each with the change versus the period before), and the days folded (🎰 · 📤 · 💵 per day). The same numbers as 💰 សរុប; today counts with its saved by-draw report until its totals settle (`groupLottery` endpoint, `lib/lotterysum.js`). Then KHR / USD / payment totals with the change versus the period before, a daily chart, a per-bank table, and the payments list with search and paging. **📤 CSV ទៅ chat** sends the range as a CSV file to the admin's private chat with the bot.
- **Billing:** expired and ending-soon groups first, each group's history, and Renew (1/3/6/12 months) for managers. Super admins also switch a group's lifetime access here.
- **Team** (super admins): every admin with their groups; set 👁 view / 🛠 manage / none per group, turn super admin on or off, or remove an admin. **➕** opens the bot's chat at `?start=addadmin`, where Telegram's user picker adds the new admin. Config super admins (`ADMIN_IDS`) can't be changed here, and you can't demote or remove yourself.
- **Settings** (super admins): the monthly price and currency, bank, account name and number, payment instructions and the support link. They're saved in the `settings` table (key `payment`, only the fields that differ from `config.js`), and ⭐ ការជាវ, Renew and `/paysupport` use them right away. The QR photo is still set with `/setqr`. The **📎 ឯកសារ** card uploads the payment QR (PNG/JPG) and the agent Excel template (.xlsx), up to 5 MB each: the bot sends the file once to the uploader's private chat to get a Telegram file id, keeps the id and deletes that message (`uploadFile` endpoint).
- **Login:** none to build. Telegram signs the user into the init data, the platform verifies it before an endpoint runs, and each endpoint checks the role (`tgcloud/lib/endpoint.js`): viewers see their groups, managers can renew. Outside Telegram the endpoints refuse every call.
- **Opening it:** set `MINIAPP_URL` in `tgcloud/lib/config.js` to the address `npm run deploy` prints (`https://app<app_id>.tgcloud.ai/`), and the private admin panel gets a **🖥 Admin app** button.
- **Endpoints** (`tgcloud/endpoints/`): `me`, `groups`, `groupReport`, `groupPayments`, `sendCsv`, `groupHistory`, `renew`, `lifetime`, `team`, `teamRole`, `teamSuper`, `teamRemove`, `settings`, `settingsSave`, `dailyGet`, `dailySave`, `groupLottery`, `logins`, `loginSave`, `loginDelete`, `loginSync`, `loginRun`, `uploadFile`. The page calls them with `Telegram.WebApp.Serverless.call` when it's hosted on `tgcloud.ai`, and with `fetch('/api/<name>')` otherwise (local testing).

## 📥 Lottery report (logins with schedules; groups follow one member)

Data comes from the lottery API through **🔑 logins**, and each group follows **one member** under a login.

**🔑 Logins** (super admins, Mini App **⚙️ ការកំណត់**): add as many as needed. Each has:

- **API URL:** only the base (`https://…/api/v1.0.0`). Pasting any URL under it keeps just the base. The routes are fixed in the bot (`lib/logins.js`): `POST auth/login`, `GET report/daily-report/all`, and the agents, members and totals calls.
- **Username and password**, sent as JSON. The password never goes back to the Mini App: it shows only that one is saved, and leaving the field blank keeps it.
- **Basic auth** on the login (optional): the generated value, with or without `Basic `.
- **Extra headers:** one `Name: value` per line (e.g. `platformtype: p99l`), sent on every call.
- **📤 សាង:** also fetch the report with `isSend=true`, saved with it (`body2`) and shown at the bottom of the report.
- **Run times:** up to 24 a day, Phnom Penh time: once a day, every 1–12 hours between two hours, or picked by hand. A switch pauses the schedule.

The token is saved on the login and reused. The bot logs in again only when there is none, when a JWT's `exp` has passed, or when a call answers 401 (then once, with one retry). Saving the login clears it. Each login's card has **🔄** (log in and fetch its agents and members again) and **▶️** (run it now, as the schedule would, and show what came back).

**A login's run** saves, with one sign-in, in **5 calls (8 with 📤 សាង) however many agents and members**:

1. everyone's by-draw report under the login (and 📤): `daily-report/all` at the login's level;
2. **every member's and every agent's** by-draw report (and 📤) from one `daily-report/all?filterByLevel=member` and one `?filterByLevel=agent` call with no user filter. The API lists one row per user and draw, by username (lottery-services `AllDailyReportServiceV2`), and the bot splits it into one saved report per user (`fetchLevelReports`), so the panel's 🔀 agent and member views open at once. A new member or agent with bets refreshes the lists first;
3. today's totals for every agent (`agent_daily_totals`): the same agent-level reply for the day tab (not asked for twice), plus `report/` and `send/total-report/all?filterByLevel=member` with no agent filter, which list every member under the login, split per agent (`collectLoginDay`).

Checked against the old one-member and one-agent calls (reports and totals) on a settled day and on today: the same draws, amounts, user/company split and Excel cells.

Nothing is posted to groups; they open 📥 from `/menu`.

**A group** (Mini App: group → **📥 ឆ្នោត**, super admins): an on/off switch and the member it follows, picked from the members saved under the logins. **In the group, people see only that member:** `/menu` → **📥 របាយការណ៍ឆ្នោត** first asks the report type, **📋 របាយការណ៍ប្រចាំថ្ងៃ** or **💰 របាយការណ៍សរុប**; each opens straight on **today**. 📋 shows the day's saved report (or fetches it then), with ◀ ▶ for the previous/next day, 🔄 ទាញថ្មី to fetch again, and 📅 ថ្ងៃផ្សេង for a day picker (today, yesterday, earlier days a week at a time; • marks saved days). 💰 shows today's totals, with ◀ ▶ and 📅 រយៈពេលផ្សេង for another day, week or month. ⬅️ returns to the type choice.

Opening a group (in the group, or from the private admin panel) always shows **only its member**. **Super admins** get their own **📥 របាយការណ៍ឆ្នោត** at the top level of the private admin panel, not tied to a group: it asks **whose** first (with several logins, pick a login before that), then the report type the same way, and **🔀 ប្តូរអ្នក** switches between everyone under the login, each agent and each member. Its buttons carry the login as `L<login id>:<data>`, and its reports show the login (🔑) where a group's show the group. The report call gets `filterByUserCode` and `filterByLevel` for whoever is shown:

| Who | `filterByUserCode` | `filterByLevel` |
|---|---|---|
| A member | the member's code | `member` |
| An agent | the agent's code | `agent` |
| Everyone | the login's own code, from its token | the login's role, e.g. `master` |

**💵 សរុបចុងក្រោយ (final result):** when there is 📤 សាង, the 📋 report and 💰 totals open with the final result in place of the plain 📈 ចំណេញ line (the Mini App shows it as a third card): the normal win/lose less 📤's **user share** (e.g. 40%), e.g. ៛283,700 − ៛10,800 = ៛272,900 (a 📤 loss adds instead). In 📋 the share is the by-draw report's `winLoseAmountKhrUser`; in 💰 it is `send/total-report`'s win/lose, which already is that share.

**💰 សរុប (totals):** from the 📥 day picker, the totals for a day, a week (Mon–Sun) or a month: bet, payout, 📈 ចំណេញ / 📉 ខាត, the change from the period before, 📤 សាង, and for a week or month the days in a folded table. In a group they're its member's. In the panel's own 📥 they can be anyone's: an agent or everyone is all its members added up. The numbers are the members' rows of `report/` and `send/total-report/all`, read from the same `agent_daily_totals` the agent Excel saves. Missing or out-of-date days are fetched and reused by both; today's row is reused for 5 minutes, and 🔄 fetches it again. The API fills a day's member totals only once the day has settled, so today usually shows no bets yet, while the by-draw report already has today's draws. Checked: the saved days added up equal the API's own range totals.

**The lottery layout** (replies shaped like `data.items[].upperLineSale`): the day's result on top (📈 ចំណេញ / 📉 ខាត, the user/company split, bet and payout, the change from the day before), then each lottery with its result and its draws by time (`04:30 PM`) in a table folded into an expandable quote. A day with no draws yet shows the per-lottery totals. Any other JSON is shown as `key: value` lines, anything else as text. Errors include the API's own reason.

**Storage:**

- `lottery_logins`: one row per login, with its token and last run.
- `group_lottery_settings`: one row per group (on/off, login, member).
- `draw_reports`: by-draw reports, **one per login, day and subject** (`''` = everyone, else a user code), kept 7 days. Each fetch replaces it, but a failed one keeps the last good one. Older days are fetched again when picked.
- `agents`: per login, with each agent's members.
- `agent_daily_totals`: per agent and day.

**The clock:** Telegram Serverless has no timer, so the sync helper is the clock. When a login changes, the bot sends the helper every enabled login's times (`POST /schedule`, kept in the helper's KV). The helper's cron runs every minute and, at each of those times, sends `/dailyrun` to the bot as its user account (a super admin). The bot deletes that message and, for every enabled login, runs its latest time that has passed today unless it already ran for it (`lib/schedule.js`). A missed minute catches up at the next trigger. Problems are reported in that private chat. Locally, `npm run dev` runs the same check every minute itself (`DEV_DAILY=0` turns it off), and `node dev/try-login.mjs <login url> [basic] ['Name: value']` tries a login without showing the token.

## 📊 Agent Excel (monthly workbook per agent)

The lottery report tool's monthly workbook, filled by the bot. **Private chat only:** in the private admin panel (`/menu` in a private chat with the bot → pick the group), a group whose 📥 report signs in gets **📊 Excel ភ្នាក់ងារ** → pick an agent → pick a month (this month and the two before) → the `.xlsx` arrives in that chat. Super admins and admins with 👁/🛠 access to the group can use it; it isn't offered in the group itself.

- **Template:** a super admin uploads the tool's `template.xlsx` in the Mini App (⚙️ ការកំណត់ → 📎 ឯកសារ), or sends it to the bot as a file with the caption `/settemplate` (checked for the MainPage, Member, M_report and 1–31 sheets). Only its Telegram file id is kept; it isn't part of this repository.
- **Agents** (`agents`, per 🔑 login; a group's Excel lists its login's agents): found through the API: the login's user code (from its token) → `user/list-user-levels?filterByLevel=agent`; **🔄** refreshes the list. Members come from the same call with `filterByLevel=member` and the agent's code.
- **Filled like `fill_day.py`:** MainPage B1 (month), D15/E15 (agent, nick) and BJ (`=-BI`); M_report's list = the agent's members (up to 16); day tab N rows 4–11 (MHSB=LEAP, MC=VN1, MT=VN2, TC=TN, KH, SC, TH, KP → C/D/E 2D/3D/4D, G win/lose) from `report/daily-report/all` at agent level, whose per-lottery summaries equal `fill_day.py`'s `total-report` per lottery; Member Tbl_01 from `report/total-report/all` and Tbl_03 (សាងលេខ) from `send/total-report/all`, one row per member with bets. That's **3 calls per day** whatever the number of members (the member endpoints return all members at once; the agent's are kept), checked identical to the tool's 8 + 2-per-member calls. Cells are edited in the sheet XML (never through a spreadsheet library) and Excel recalculates on open. Hand-typed sheets (Expence, Tbl_02, Tbl_04, Close) stay blank for now.
- **Days are saved and reused** (`agent_daily_totals`, kept three months, shared with 💰 សរុប): a finished day is final once it was fetched an hour after it ended (one fetched earlier is fetched once more); today's row is reused for 5 minutes (🔄 fetches it again). The Excel itself takes the days up to yesterday. Each agent's members are saved with it (`agents.members`): fetched the first time and on 🔄, and again by themselves when a day shows a member with bets who isn't in the list. `/dailyrun` saves yesterday for every agent, so the current month is usually ready at once; missing days are fetched when asked (a whole month takes about 7 s; a tap stops after 12 s and the screen says how far it got). A 500 or 429 from the API is retried twice.
- `lib/zip.js` reads and writes the `.xlsx` zip without packages (the runtime's DecompressionStream / CompressionStream when there, a built-in inflater otherwise).

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
  endpoints/             the admin Mini App's server side (me, groups, groupReport, …)
  lib/
    report.js, ui.js     report text and keyboards
    store.js, roles.js   database access, who may do what
    admin.js             private admin panel and team screens
    billing.js, sync.js  subscriptions, sync helper client
    endpoint.js          caller and role checks for endpoints
    dates.js, parse.js, telegram.js
webapp/                  admin Mini App front-end (Vite + React), built into webapp/dist
sync-helper/             Cloudflare Worker that reads group history (mtcute)
dev/                     local runner (bot + Mini App) with a stand-in for the platform sdk
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

Create the KV namespace for the 📥 lottery report schedule once, and put the `id` it prints into `wrangler.jsonc` (`kv_namespaces`):

```bash
npx wrangler login
npx wrangler kv namespace create SCHEDULE
```

Deploy, then upload the secrets:

```bash
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
   npm install --prefix webapp
   npx tgcloud login
   npm run deploy          # builds webapp/ and runs tgcloud push
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

### Run the admin Mini App locally

`npm run dev` also serves the built Mini App and its endpoints on `http://localhost:8790` (`dev/miniapp.js`). Build it first with `npm run build`, or run `npm run webapp` for Vite's live-reload server (it doesn't proxy `/api`, so use it for layout work).

- **In a browser:** add `DEV_FAKE_USER_ID=<your Telegram id>` to `.env.local`. It stands in for Telegram's init data, but only for requests made directly on localhost.
- **In Telegram:** Mini Apps need https, so open a tunnel (for example `cloudflared tunnel --url http://localhost:8790`), put its address in `MINIAPP_URL`, restart, and tap **🖥 Admin app** in the private panel. The runner verifies Telegram's signature on the init data (HMAC with the bot token, at most 24 hours old) the way the platform does; a forged or missing signature gets 401, and the fake user never applies through a tunnel.

### Tests and platform tools

```bash
npm test                                                          # dates, parsing, reports, keyboards
npx tgcloud run handlers/message '{ chat: { id: -100123 }, from: { id: 1 }, text: "/start" }'
npx tgcloud status                                                # what would be deployed
```
