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
  priceCents: integer('price_cents').deprecated('replaced by price + currency'),
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
  // The newest Telegram message id in a group (the group's link on report
  // titles in the private panel): read straight off the index, not by
  // reading every payment of the group.
  latest: index('idx_messages_tg').on(t.groupId, t.tgMessageId),
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

// Lottery API logins (super admins, Mini App ⚙️ → 🔑): each with its own API,
// credentials and run times. A run (lib/schedule.js) fetches, for that login:
// everyone's by-draw report, the by-draw report of each member a group follows,
// and every member's day totals (agent_daily_totals). The password and token
// never reach the Mini App (it only learns whether a password is saved).
export const lotteryLogins = table('lottery_logins', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  enabled:    boolean('enabled').notNull().default(true),
  // The API's base ('https://…/api/v1.0.0'); the routes are fixed in lib/logins.js.
  baseUrl:    text('base_url').notNull().default(''),
  username:   text('username').notNull().default(''),
  password:   text('password').notNull().default(''),
  // HTTP Basic auth on the login request (the ready-made base64 value, without 'Basic ').
  basicAuth:  text('basic_auth').notNull().default(''),
  // Extra headers on every call, one 'Name: value' per line.
  headers:    text('headers').notNull().default(''),
  // Also fetch the 📤 សាង side (isSend=true).
  sendReport: boolean('send_report').notNull().default(true),
  times:      text('times').notNull().default('21:00'), // 'HH:MM,…', Phnom Penh
  // The last token, reused until it expires or a call answers 401; cleared on save.
  token:      text('token').notNull().default(''),
  // The last scheduled run: its day and time slot, so a time isn't run twice.
  ranDay:     text('ran_day').notNull().default(''),
  ranSlot:    text('ran_slot').notNull().default(''),
});

// A group's lottery report (super admins switch it on): which login and which
// member under it the group follows. groupId is groups.id; agentCode is the
// member's agent. In the group, people see only this member.
export const groupLotterySettings = table('group_lottery_settings', {
  groupId:    integer('group_id').primaryKey(),
  enabled:    boolean('enabled').notNull().default(false),
  loginId:    integer('login_id').notNull().default(0),
  memberCode: text('member_code').notNull().default(''),
  memberName: text('member_name').notNull().default(''),
  agentCode:  text('agent_code').notNull().default(''),
});

// By-draw report snapshots, per login, day and subject (a member's or agent's
// user code; '' = everyone under the login): the latest fetch, replaced on each
// run except that a failed run keeps the last good one. body is the reply cut
// to the fields shown (~4 KB); body2 the 📤 សាង side, empty when off. Kept 7
// days; older days are fetched again when picked.
export const drawReports = table('draw_reports', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  loginId:    integer('login_id').notNull(),
  day:        text('day').notNull(), // 'YYYY-MM-DD', Phnom Penh
  subject:    text('subject').notNull().default(''),
  slot:       text('slot').deprecated('never read; the run time is lottery_logins.ran_slot'),
  ranAt:      integer('ran_at').notNull(),
  ok:         boolean('ok').notNull().default(false),
  httpStatus: integer('http_status').notNull().default(0),
  body:       text('body').notNull().default(''),
  error:      text('error'),
  body2:      text('body2').notNull().default(''),
  error2:     text('error2'),
}, (t) => ({
  day: uniqueIndex('draw_reports_login_day_subject_uniq').on(t.loginId, t.day, t.subject),
}));

// Lottery agents under a login, found through the API (the login's user code
// → user/list-user-levels?filterByLevel=agent), each with its members, for
// the member pickers, totals and the agent Excel (lib/agents.js). userCode is
// the lottery system's code for the agent.
export const agents = table('agents', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  loginId:  integer('login_id').notNull(),
  userCode: text('user_code').notNull(),
  username: text('username').notNull(),
  nickname: text('nickname').notNull().default(''),
  // The agent's members, JSON [{ username, userCode, nickname }]: fetched the
  // first time, on 🔄, and again when a day shows a member not in it.
  members:  text('members').notNull().default('[]'),
}, (t) => ({
  uniq: uniqueIndex('agents_login_code_uniq').on(t.loginId, t.userCode),
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
