// ⭐ ការជាវ receipts (manual billing). A customer taps 💬 ផ្ញើវិក្កយបត្រ in
// their group; the bot asks for the transfer receipt as a reply there. The
// receipt is copied to the super admins and the group's managers in their
// private chats with one-tap buttons: ✅ 1 / 3 / 6 / 12 ខែ renews the group
// (as /sync → 🔄 Renew does) and ❌ turns it down. Every admin's copy then
// says who handled it, so a receipt is handled once.
//
// State: settings 'receipt:<group id>:<message id>' →
//   { status: 'pending' | 'renewed' | 'rejected', copies: [[chatId, messageId]],
//     from: '<name>', by: '<admin>', months }.

import { api } from 'sdk';
import { offerLabel, priceFor, priceLabel } from './billing.js';
import { dayOf, formatKhmerDate } from './dates.js';
import { canManage, listAdmins, managersOf, roleIn } from './roles.js';
import { paymentSettings } from './settings.js';
import { getGroupById, getSetting, latestSubscription, renewSubscription, setSetting } from './store.js';
import { getMe } from './telegram.js';
import { RENEW_MONTHS } from './ui.js';
import { logActivity } from './activity.js';

/** The first line of the bot's request; a reply to it is a receipt. */
export const RECEIPT_ASK = '🧾 ផ្ញើវិក្កយបត្រ';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nameOf = (u) => (u?.username ? `@${u.username}` : [u?.first_name, u?.last_name].filter(Boolean).join(' ') || String(u?.id ?? ''));
const keyOf = (groupId, messageId) => `receipt:${groupId}:${messageId}`;

/** RECEIPT: asks for the receipt in the group, as a reply to this message. */
export function askForReceipt(chatId) {
  return api.sendMessage({
    chat_id: chatId,
    text: `${RECEIPT_ASK}\nសូមផ្ញើរូបវិក្កយបត្រផ្ទេរប្រាក់ ដោយឆ្លើយតប (Reply) សារនេះ។ Admin នឹងពិនិត្យ ហើយបន្តការជាវជូន។`,
    reply_markup: { force_reply: true, input_field_placeholder: 'រូបវិក្កយបត្រ' },
  });
}

/** Is this group message a receipt: a photo (or image file) replying to the bot's request? */
export async function isReceipt(message) {
  const asked = message.reply_to_message;
  const image = !!(message.photo || message.document?.mime_type?.startsWith('image/'));
  return image && !!asked && (asked.text ?? '').startsWith(RECEIPT_ASK) && asked.from?.id === (await getMe()).id;
}

/** Copies a receipt to the super admins and the group's managers, with the buttons. */
export async function forwardReceipt(message, group) {
  const pay = await paymentSettings();
  const latest = await latestSubscription(group.id);
  const end = latest ? formatKhmerDate(dayOf(latest.endDate)) : '🆕 ក្រុមថ្មី (មិនទាន់ធ្លាប់ជាវ)';
  const caption = [
    `🧾 <b>វិក្កយបត្រ · 🏪 ${esc(group.name ?? group.tgId)}</b>`,
    `👤 ${esc(nameOf(message.from))}`,
    `📅 សុពលភាពបច្ចុប្បន្ន: ${esc(end)}`,
    `💵 តម្លៃ: ${esc(priceLabel(1, pay))} / ខែ`,
    message.caption ? `💬 ${esc(message.caption.slice(0, 300))}` : null,
  ].filter(Boolean).join('\n');
  const data = (months) => `RCPT_${group.id}_${message.message_id}_${months}`;
  const months = RENEW_MONTHS.map((m) => ({ text: `✅ ${m} ខែ · ${offerLabel(m, pay)}`, callback_data: data(m), style: 'success' }));
  const reply_markup = {
    inline_keyboard: [months.slice(0, 2), months.slice(2), [{ text: '❌ មិនទទួល', callback_data: data(0), style: 'danger' }]],
  };

  const supers = (await listAdmins()).filter((a) => a.isSuper).map((a) => a.userId);
  const to = [...new Set([...supers, ...(await managersOf(group.id))])];
  const copies = [];
  for (const chatId of to) {
    try {
      const copy = await api.copyMessage({ chat_id: chatId, from_chat_id: message.chat.id, message_id: message.message_id, caption, parse_mode: 'HTML', reply_markup });
      copies.push([chatId, copy.message_id]);
    } catch (e) {
      // An admin who never started the bot can't be messaged; the others still get it.
      console.error('receipt to admin', chatId, e.description ?? e.message);
    }
  }
  await setSetting(keyOf(group.id, message.message_id), JSON.stringify({ status: 'pending', copies, from: nameOf(message.from) }));
  await api.sendMessage({
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    text: copies.length
      ? '✅ បានទទួលវិក្កយបត្រ។ Admin នឹងពិនិត្យ ហើយបន្តការជាវជូនឆាប់ៗ។'
      : `⚠️ មិនអាចផ្ញើទៅ Admin បានទេ។ សូមទាក់ទង ${pay.supportLink}`,
  });
}

/**
 * RCPT_<group id>_<message id>_<months> from an admin's copy: months renews
 * the group, 0 turns the receipt down. Returns the alert to show (or null).
 */
export async function handleReceiptButton(data, from) {
  const [, groupId, messageId, monthsText] = /^RCPT_(\d+)_(\d+)_(\d+)$/.exec(data) ?? [];
  const months = Number(monthsText);
  const group = groupId && (await getGroupById(Number(groupId)));
  if (!group || (months && !RENEW_MONTHS.includes(months))) return 'វិក្កយបត្រនេះមិនត្រឹមត្រូវ។';
  if (!canManage(await roleIn(from, group.tgId))) return 'You are not admin 😡';
  const key = keyOf(group.id, messageId);
  const rec = JSON.parse((await getSetting(key)) ?? 'null');
  if (!rec) return 'រកមិនឃើញវិក្កយបត្រនេះទេ។';
  if (rec.status !== 'pending') return `បានដោះស្រាយរួចហើយ ដោយ ${rec.by}។`;
  // Taken first, so a second tap (here or on another admin's copy) can't renew twice.
  Object.assign(rec, { status: months ? 'renewed' : 'rejected', by: nameOf(from), months });
  await setSetting(key, JSON.stringify(rec));

  const pay = await paymentSettings();
  let result;
  let label; // the short form, on every admin's copy
  if (months) {
    const sub = await renewSubscription(group.id, { months, price: priceFor(months, pay), currency: pay.currency, recordedBy: from.id });
    await logActivity(from, 'group.renew', group.name ?? String(group.tgId), `🧾 +${months} ខែ`);
    const end = dayOf(sub.endDate);
    const until = formatKhmerDate(end);
    result = `✅ បានបន្ត ${months} ខែ (${priceLabel(months, pay)}) ដល់ ${until} · ដោយ ${rec.by}`;
    label = `✅ ${months} ខែ → ${String(end.d).padStart(2, '0')}/${String(end.m).padStart(2, '0')}/${end.y} · ${rec.by}`;
    await api.sendMessage({ chat_id: group.tgId, reply_to_message_id: Number(messageId), text: `✅ ការជាវត្រូវបានបន្ត ដល់ ${until}។ ប្រើ /menu ដើម្បីមើលរបាយការណ៍។` }).catch(() => {});
  } else {
    result = `❌ មិនទទួល · ដោយ ${rec.by}`;
    label = result;
    await api.sendMessage({
      chat_id: group.tgId,
      reply_to_message_id: Number(messageId),
      text: '❌ វិក្កយបត្រនេះមិនត្រូវបានទទួលទេ។ សូមទាក់ទង Admin ដើម្បីពិនិត្យ។',
      reply_markup: { inline_keyboard: [[{ text: '🆘 Support', url: pay.supportLink }]] },
    }).catch(() => {});
  }
  // Every admin's copy: what happened, as a greyed-out button (Bot API 10.3), in place of the choices.
  for (const [chatId, copyId] of rec.copies) {
    await api.editMessageReplyMarkup({ chat_id: chatId, message_id: copyId, reply_markup: { inline_keyboard: [[{ text: label, disabled: {} }]] } }).catch(() => {});
  }
  return result;
}
