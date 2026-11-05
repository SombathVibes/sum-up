import { table, integer, text, boolean, index, uniqueIndex, sql } from 'sdk/db';

// No foreign keys on this platform: groupId columns point at groups.id and are
// kept consistent by lib/ code. All dates are unix seconds (UTC).

export const groups = table('groups', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  tgId:          integer('tg_id').notNull().unique(),
  name:          text('name'),
  status:        text('status').notNull().default('active'),
  // Lifetime access (e.g. the owner's own groups): never expires, no billing.
  lifetime:      boolean('lifetime').notNull().default(false),
  // Highest Telegram message id pulled through the sync helper (the user
  // account's numbering; live bot messages don't move it).
  lastMessageId: integer('last_message_id').notNull().default(0),
  lastSyncedAt:  integer('last_synced_at').notNull().default(0),
  // Telegram Stars subscription: '' (none), 'active', 'canceled' (runs to the
  // end of the paid period), or 'failed' (last renewal payment failed).
  billingStatus: text('billing_status').notNull().default(''),
  billingUserId: integer('billing_user_id').notNull().default(0),
  createdAt:     integer('created_at').notNull().default(sql`(unixepoch())`),
});

// One row per paid (or free) period; renewals add rows, so this is also the
// payment history.
export const subscriptions = table('subscriptions', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  groupId:   integer('group_id').notNull(),
  startDate: integer('start_date').notNull(),
  endDate:   integer('end_date').notNull(),
  source:    text('source').notNull().default('manual'), // 'trial' | 'manual' | 'stars'
  // In the currency's smallest unit; for 'XTR' (Telegram Stars) that's Stars.
  price:     integer('price').notNull().default(0),
  currency:  text('currency').notNull().default(''),
  isTrial:   boolean('is_trial').notNull().default(false),
  payerId:   integer('payer_id'),                // Stars: who paid
  recordedBy: integer('recorded_by'),             // manual: the admin who recorded it
  // Telegram's charge id: needed for refunds, and makes a payment count once.
  chargeId:  text('charge_id').unique(),
}, (t) => ({
  groupIdx: index('idx_subscriptions_group').on(t.groupId, t.endDate),
}));

export const messages = table('messages', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  groupId:     integer('group_id').notNull(),
  tgMessageId: integer('tg_message_id').notNull(),
  botTgId:     integer('bot_tg_id').notNull(),
  // Amounts are stored in hundredths (cents / sen) to keep sums exact.
  amount:      integer('amount').notNull(),
  currency:    text('currency').notNull(), // 'USD' | 'KHR'
  date:        integer('message_date').notNull(),
  text:        text('original_message').notNull(),
}, (t) => ({
  // The same payment can arrive live (bot) and from /sync (user account). In
  // basic groups each account numbers messages separately, so match on
  // sender + time + text rather than tg_message_id.
  uniqPayment: uniqueIndex('uq_messages_payment').on(t.groupId, t.botTgId, t.date, t.text),
  // Covering index for every report query (WHERE group_id, message_date range;
  // reads bot, currency, amount): answered from the index alone, without
  // touching the long original_message rows.
  report: index('idx_messages_report').on(t.groupId, t.date, t.botTgId, t.currency, t.amount),
}));

// Small key/value settings changed from Telegram, e.g. 'payment_qr' (a photo file_id set with /setqr).
export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
});

// Bot admins. is_super: can do everything, including managing admins
// (ADMIN_IDS in config are copied in as super admins and can't be demoted).
// Other admins' rights come only from admin_groups.
export const admins = table('admins', {
  userId:    integer('user_id').primaryKey(),
  name:      text('name'),
  username:  text('username'),
  isSuper:   boolean('is_super').notNull().default(false),
  addedBy:   integer('added_by').notNull(), // 0 = from config
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

// What an admin may do in a group: 'view' (reports in their private panel) or
// 'manage' (also Sync, Renew, History). groupId is groups.id.
export const adminGroups = table('admin_groups', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  userId:  integer('user_id').notNull(),
  groupId: integer('group_id').notNull(),
  role:    text('role').notNull(), // 'view' | 'manage'
}, (t) => ({
  uniq:    uniqueIndex('uq_admin_groups').on(t.userId, t.groupId),
  byGroup: index('idx_admin_groups_group').on(t.groupId),
}));

// Report source: one per group (off by default; super admins switch it on).
// At each of `times` (Phnom Penh, 'HH:MM,HH:MM', sorted) the bot calls `url`
// and saves what it returns as a snapshot (lib/daily.js). In the URL, {date}
// becomes the day ('YYYY-MM-DD'), {group} the group's Telegram id and
// {member} the bound member's user code.
// groupId is groups.id.
export const groupLotterySettings = table('group_lottery_settings', {
  groupId:     integer('group_id').primaryKey(),
  enabled:     boolean('enabled').notNull().default(false),
  // The lottery API's base ('https://…/api/v1.0.0'); the routes are fixed:
  // POST auth/login, GET report/daily-report/all (lib/daily.js).
  baseUrl:     text('base_url').notNull().default(''),
  // Also fetch the 📤 សាង side (the same report with isSend=true), saved
  // alongside (draw_reports.body2).
  sendReport:  boolean('send_report').notNull().default(true),
  memberCode:  text('member_code').notNull().default(''),
  memberName:  text('member_name').notNull().default(''),
  agentCode:   text('agent_code').notNull().default(''),
  times:       text('times').notNull().default('21:00'),
  postToGroup: boolean('post_to_group').notNull().default(true),
  // The lottery login: POST { username, password } as JSON to auth/login; the
  // token comes back in the reply and goes on every call as
  // 'Authorization: Bearer <token>'. The password never leaves the bot: the
  // Mini App only learns whether one is saved.
  username:    text('username').notNull().default(''),
  password:    text('password').notNull().default(''),
  // Optional HTTP Basic auth on the login request itself: the ready-made
  // credentials (base64 of 'id:secret', without 'Basic '). Shown in the Mini
  // App so it can be checked (unlike password).
  basicAuth:   text('basic_auth').notNull().default(''),
  // Extra request headers sent on both the login and the report call, one
  // 'Name: value' per line (e.g. 'X-Platform: web').
  headers:     text('headers').notNull().default(''),
  // The last token from login, reused until it expires (JWT exp) or the
  // report call answers 401; cleared whenever the settings are saved.
  token:       text('token').notNull().default(''),
});

// Report snapshot: the latest fetch per group and day; each run replaces it,
// except that a failed run keeps the last good one. slot is the scheduled
// 'HH:MM' it last ran for (a manual run: the minute it ran), so a time isn't
// run twice. body is the response: for the lottery report only the fields it
// shows (~4 KB instead of ~70 KB), otherwise the text cut at 300 KB. Kept
// 7 days; older days are fetched again when picked.
export const drawReports = table('draw_reports', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  groupId:    integer('group_id').notNull(),
  day:        text('day').notNull(), // 'YYYY-MM-DD', Phnom Penh
  slot:       text('slot').notNull().default(''), // 'HH:MM', Phnom Penh: the time it last ran for
  ranAt:      integer('ran_at').notNull(),
  ok:         boolean('ok').notNull().default(false),
  httpStatus: integer('http_status').notNull().default(0),
  body:       text('body').notNull().default(''),
  error:      text('error'),
  // The 📤 សាង side (isSend=true, group_lottery_settings.send_report), stored the same way; empty when off.
  body2:      text('body2').notNull().default(''),
  error2:     text('error2'),
  // Whose report it is: a member's or agent's user code, '' for everyone under
  // the group's login (the scheduled run fetches the group's default: its bound
  // member, else everyone; others are fetched when someone picks them).
  subject:    text('subject').notNull().default(''),
}, (t) => ({
  // One per group, day and subject; also serves a group's last few days, newest first.
  day: uniqueIndex('draw_reports_day_subject_uniq').on(t.groupId, t.day, t.subject),
}));

// Lottery agents under a group's report login, found through the API (the
// login's user code → user/list-user-levels?filterByLevel=agent) for the
// agent Excel report (lib/agents.js). groupId is groups.id; userCode is the
// lottery system's code for the agent.
export const agents = table('agents', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  groupId:  integer('group_id').notNull(),
  userCode: text('user_code').notNull(),
  username: text('username').notNull(),
  nickname: text('nickname').notNull().default(''),
  // The agent's members, JSON [{ username, userCode, nickname }]: fetched the
  // first time, on 🔄, and again when a day shows a member not in it.
  members:  text('members').notNull().default('[]'),
}, (t) => ({
  uniq: uniqueIndex('agents_group_code_uniq').on(t.groupId, t.userCode),
}));

// One day of an agent's figures, shared by the agent Excel and 💰 សរុប:
// data is JSON { daily: { 'C5': 52700, … }, m1: [member rows], m3: [សាង
// member rows] }. fetched_at says how current it is: today's row is fetched
// again after 5 minutes, and a day fetched before it was over is fetched once
// more afterwards; then it's final. Kept about three months.
export const agentDailyTotals = table('agent_daily_totals', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  agentCode: text('agent_code').notNull(),
  day:       text('day').notNull(), // 'YYYY-MM-DD', Phnom Penh
  data:      text('data').notNull(),
  fetchedAt: integer('fetched_at').notNull().default(0), // 0: saved before this was kept (a finished day)
}, (t) => ({
  uniq: uniqueIndex('agent_daily_totals_code_day_uniq').on(t.agentCode, t.day),
}));
