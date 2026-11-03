// Pulls payment-bot messages through the sync helper (sync-helper/), which reads
// group history as a Telegram user account. Bots can't see other bots' messages,
// so this is the only way in.

import { fetch } from 'sdk';
import { SYNC_HELPER_SECRET, SYNC_HELPER_URL, WHITELIST_BOTS } from './config.js';
import { monthRange, today } from './dates.js';
import { parseAmount } from './parse.js';
import { markSynced, replaceMessagesInRange, saveMessages } from './store.js';

async function fetchHistory({ chatId, minId = 0, since, until }) {
  const res = await fetch(`${SYNC_HELPER_URL}/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SYNC_HELPER_SECRET}`,
    },
    body: JSON.stringify({
      chatId,
      minId,
      since,
      until,
      senders: Object.keys(WHITELIST_BOTS).map(Number),
    }),
  });
  if (!res.ok) throw new Error(`Sync helper ${res.status}: ${await res.text()}`);
  return res.json(); // { messages: [{ id, date, senderId, text }], maxId }
}

function toRows(history) {
  const rows = [];
  for (const m of history) {
    const parsed = parseAmount(m.text);
    if (!parsed) continue;
    rows.push({
      tgMessageId: m.id,
      botTgId: m.senderId,
      amount: parsed.amount,
      currency: parsed.currency,
      date: m.date,
      text: m.text,
    });
  }
  return rows;
}

/**
 * Catch-up for payments the bot missed (e.g. while it was down): fetches
 * messages newer than the last helper sync and returns how many payments it
 * saw. Copies already received live are skipped by uq_messages_payment. A
 * group never synced through the helper starts from the current month.
 */
export async function syncNew(group) {
  const since = group.lastMessageId ? undefined : monthRange(today().y, today().m).start;
  const result = await fetchHistory({ chatId: group.tgId, minId: group.lastMessageId, since });
  const rows = toRows(result.messages);
  await saveMessages(group.id, rows);
  await markSynced(group.id, result.maxId);
  return rows.length;
}

/** Re-reads a whole range and replaces what is stored for it. */
export async function syncRange(group, range) {
  const result = await fetchHistory({ chatId: group.tgId, since: range.start, until: range.end });
  const rows = toRows(result.messages);
  await replaceMessagesInRange(group.id, range, rows);
  await markSynced(group.id, result.maxId);
  return rows.length;
}
