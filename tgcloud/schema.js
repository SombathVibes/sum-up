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

// Daily report (off by default; super admins switch it on per group): at
// `time` (Phnom Penh, 'HH:MM') the bot calls `url` and saves what it returns.
// In the URL, {date} becomes the day ('YYYY-MM-DD') and {group} the group's
// Telegram id. groupId is groups.id.
export const dailyConfigs = table('daily_configs', {
  groupId:     integer('group_id').primaryKey(),
  enabled:     boolean('enabled').notNull().default(false),
  url:         text('url').notNull().default(''),
  time:        text('time').notNull().default('21:00'),
  postToGroup: boolean('post_to_group').notNull().default(true),
  updatedAt:   integer('updated_at').notNull().default(sql`(unixepoch())`),
});

// One fetched report per group and day (a re-run replaces it). body is the
// response text, cut at 100 KB.
export const dailyReports = table('daily_reports', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  groupId:    integer('group_id').notNull(),
  day:        text('day').notNull(), // 'YYYY-MM-DD', Phnom Penh
  ranAt:      integer('ran_at').notNull(),
  ok:         boolean('ok').notNull().default(false),
  httpStatus: integer('http_status').notNull().default(0),
  body:       text('body').notNull().default(''),
  error:      text('error'),
}, (t) => ({
  uniq: uniqueIndex('uq_daily_reports_day').on(t.groupId, t.day),
}));
