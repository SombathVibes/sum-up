// Database access: groups, subscriptions, and payment messages.

import { db } from 'sdk';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'sdk/db';
import { groups, messages, settings, subscriptions } from '../schema.js';
import { TRIAL_MONTHS } from './config.js';
import { now } from './dates.js';

const PP_OFFSET = 7 * 3600;
const INSERT_CHUNK = 100;

export const getGroup = (tgId) =>
  db.select().from(groups).where(eq(groups.tgId, tgId)).get();

/** Every registered group (Telegram group ids are negative; private chats aren't groups). */
export const listGroups = () =>
  db.select().from(groups).where(lt(groups.tgId, 0)).orderBy(asc(groups.name)).all();

/** Creates or renames the group; a brand-new group gets a trial unless trial is false. */
export async function upsertGroup(tgId, name, { trial = true } = {}) {
  const existing = await getGroup(tgId);
  if (existing) {
    if (name && existing.name !== name) {
      await db.update(groups).set({ name }).where(eq(groups.id, existing.id)).run();
    }
    return { ...existing, name: name ?? existing.name };
  }
  const [group] = await db.insert(groups).values({ tgId, name }).returning().run();
  if (trial) await createTrial(group.id);
  return group;
}

export async function createTrial(groupId) {
  const start = now();
  await db.insert(subscriptions).values({
    groupId,
    startDate: start,
    endDate: addMonthsTs(start, TRIAL_MONTHS),
    source: 'trial',
    isTrial: true,
  }).run();
}

/** The subscription period that ends last (current or most recent), or null. */
export const latestSubscription = (groupId) => db.select().from(subscriptions)
  .where(eq(subscriptions.groupId, groupId))
  .orderBy(desc(subscriptions.endDate))
  .get();

/** Lifetime groups always have access; others need a period covering now. */
export async function hasActiveSubscription(group) {
  if (group.lifetime) return true;
  const t = now();
  const sub = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.groupId, group.id), lte(subscriptions.startDate, t), gte(subscriptions.endDate, t)))
    .get();
  return !!sub;
}

export const setLifetime = (groupId, lifetime) =>
  db.update(groups).set({ lifetime }).where(eq(groups.id, groupId)).run();

/**
 * Records a manual payment: `months` more after the current period (or from
 * today if it has ended), for `price` in `currency`'s smallest unit.
 */
export async function renewSubscription(groupId, { months, price, currency, recordedBy }) {
  const latest = await latestSubscription(groupId);
  const startDate = Math.max(latest?.endDate ?? 0, now());
  const [row] = await db.insert(subscriptions)
    .values({ groupId, startDate, endDate: addMonthsTs(startDate, months), source: 'manual', price, currency, recordedBy })
    .returning()
    .run();
  return row;
}

/** The group's most recent periods, newest first. */
export const subscriptionHistory = (groupId, limit = 10) => db.select().from(subscriptions)
  .where(eq(subscriptions.groupId, groupId))
  .orderBy(desc(subscriptions.endDate))
  .limit(limit)
  .all();

/**
 * Records a Telegram Stars payment as a paid period. Returns false if this
 * charge was already recorded (Telegram may deliver an update twice).
 */
export async function recordStarsPayment(groupId, { chargeId, payerId, amount, endDate }) {
  const latest = await latestSubscription(groupId);
  const startDate = now();
  const rows = await db.insert(subscriptions)
    .values({
      groupId,
      startDate,
      // Telegram sends the paid-until date; it never shortens a longer period already granted.
      endDate: Math.max(endDate, latest?.endDate ?? 0),
      source: 'stars',
      price: amount,
      currency: 'XTR',
      payerId,
      chargeId,
    })
    .onConflictDoNothing()
    .returning()
    .run();
  return rows.length > 0;
}

export const setBillingStatus = (groupId, billingStatus, billingUserId) =>
  db.update(groups)
    .set(billingUserId ? { billingStatus, billingUserId } : { billingStatus })
    .where(eq(groups.id, groupId))
    .run();

/** Records a sync; lastMessageId only moves forward. */
export const markSynced = (groupId, lastMessageId) => db.update(groups)
  .set({ lastSyncedAt: now(), lastMessageId: sql`max(${groups.lastMessageId}, ${lastMessageId})` })
  .where(eq(groups.id, groupId))
  .run();

/** Inserts parsed messages, skipping any already stored. */
export async function saveMessages(groupId, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(messages)
      .values(rows.slice(i, i + INSERT_CHUNK).map((r) => ({ groupId, ...r })))
      .onConflictDoNothing() // uq_messages_payment
      .run();
  }
}

/** Replaces everything stored for the group inside the range. */
export async function replaceMessagesInRange(groupId, range, rows) {
  await db.delete(messages)
    .where(and(eq(messages.groupId, groupId), gte(messages.date, range.start), lte(messages.date, range.end)))
    .run();
  await saveMessages(groupId, rows);
}

/** Per bot and currency totals for a range: [{ botTgId, currency, total, ops, first, last }]. */
export const totalsByBot = (groupId, range) => db.all(sql`
  SELECT bot_tg_id AS botTgId, currency, SUM(amount) AS total, COUNT(*) AS ops,
         MIN(message_date) AS first, MAX(message_date) AS last
  FROM messages
  WHERE group_id = ${groupId} AND message_date BETWEEN ${range.start} AND ${range.end}
  GROUP BY bot_tg_id, currency
  ORDER BY first`);

/**
 * Per Phnom Penh day and currency totals: [{ day: 'YYYY-MM-DD', currency, total, ops }],
 * optionally for one bank only.
 */
export const totalsByDay = (groupId, range, botTgId = null) => db.all(sql`
  SELECT date(message_date + ${PP_OFFSET}, 'unixepoch') AS day, currency,
         SUM(amount) AS total, COUNT(*) AS ops
  FROM messages
  WHERE group_id = ${groupId} AND message_date BETWEEN ${range.start} AND ${range.end}
    ${botTgId ? sql`AND bot_tg_id = ${botTgId}` : sql.raw('')}
  GROUP BY day, currency
  ORDER BY day`);

function addMonthsTs(ts, n) {
  const d = new Date(ts * 1000);
  d.setUTCMonth(d.getUTCMonth() + n);
  return Math.floor(d.getTime() / 1000);
}

export async function getSetting(key) {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export const setSetting = (key, value) => db.insert(settings)
  .values({ key, value })
  .onConflictDoUpdate({ target: settings.key, set: { value } })
  .run();

/** The latest payments in a range, newest first: [{ date, amount, currency, botTgId }]. */
export const recentPayments = (groupId, range, limit = 100) => db.select().from(messages)
  .where(and(eq(messages.groupId, groupId), gte(messages.date, range.start), lte(messages.date, range.end)))
  .orderBy(desc(messages.date))
  .limit(limit)
  .all();

/** The newest stored Telegram message id in a group (0 if none). */
export async function latestTgMessageId(groupId) {
  const row = await db.get(sql`SELECT MAX(tg_message_id) AS id FROM messages WHERE group_id = ${groupId}`);
  return row?.id ?? 0;
}

/**
 * Payments in a range for the Mini App, newest first, optionally only those
 * whose text contains `q`: { items: [{ date, amount, currency, botTgId, text }], total }.
 */
export async function paymentsPage(groupId, range, { q = '', offset = 0, limit = 50 } = {}) {
  const filter = q ? sql`AND original_message LIKE ${`%${q}%`}` : sql.raw('');
  const where = sql`group_id = ${groupId} AND message_date BETWEEN ${range.start} AND ${range.end} ${filter}`;
  const items = await db.all(sql`
    SELECT message_date AS date, amount, currency, bot_tg_id AS botTgId, original_message AS text
    FROM messages WHERE ${where}
    ORDER BY message_date DESC LIMIT ${limit} OFFSET ${offset}`);
  const count = await db.get(sql`SELECT COUNT(*) AS n FROM messages WHERE ${where}`);
  return { items, total: count?.n ?? 0 };
}
