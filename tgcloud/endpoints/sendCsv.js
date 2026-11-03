// Sends a group's payments for a date range to the caller's private chat with
// the bot as a CSV file (downloads from inside Telegram's Mini App view are
// unreliable; a document in the chat always works).

import { api, InputFile } from 'sdk';
import { WHITELIST_BOTS } from '../lib/config.js';
import { dayKey, dayOf, formatTime } from '../lib/dates.js';
import { parseRange, requireGroup } from '../lib/endpoint.js';
import { paymentsPage } from '../lib/store.js';

const MAX_ROWS = 50000; // keeps the file well under Telegram's 50 MB upload limit

const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;

export default async function (input, ctx) {
  const { user, group } = await requireGroup(ctx, input.groupId);
  const range = parseRange(input.from, input.to);
  const { items, total } = await paymentsPage(group.id, range, { limit: MAX_ROWS });

  const lines = ['date,time,bank,currency,amount,message'];
  for (const p of items.reverse()) {
    lines.push([dayKey(dayOf(p.date)), formatTime(p.date), WHITELIST_BOTS[p.botTgId] ?? p.botTgId, p.currency, p.amount / 100, p.text].map(cell).join(','));
  }
  // A BOM so Excel opens the Khmer text as UTF-8.
  const bytes = new TextEncoder().encode(`﻿${lines.join('\n')}\n`);
  const name = `${(group.name ?? group.tgId).toString().replace(/[^\p{L}\p{N}]+/gu, '_')}_${range.from}_${range.to}.csv`;
  await api.sendDocument({
    chat_id: user.id,
    document: new InputFile(bytes, name, { type: 'text/csv' }),
    caption: `🧾 ${group.name ?? group.tgId} · ${range.from} → ${range.to} · ${items.length} ប្រតិបត្តិការ${total > items.length ? ` (first ${items.length} of ${total})` : ''}`,
  });
  return { sent: items.length, total };
}
