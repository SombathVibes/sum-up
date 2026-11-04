// Monthly per-group subscriptions. BILLING_MODE 'manual': customers pay outside
// Telegram and an admin records it (/sync → Renew). 'stars': customers subscribe
// with Telegram Stars; the invoice payload names the group, so whoever pays
// (usually the group owner) pays for that group.

import { api } from 'sdk';
import { BILLING_MODE, SUBSCRIPTION_STARS } from './config.js';
import { dayOf, formatKhmerDate, now } from './dates.js';
import { money } from './report.js';
import { paymentSettings } from './settings.js';
import { getGroup, getSetting, latestSubscription, recordStarsPayment, setBillingStatus, upsertGroup } from './store.js';

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PERIOD = 2592000; // 30 days, the only period Telegram allows

const payload = (groupTgId) => `sub:${groupTgId}`;
function groupFromPayload(p) {
  const match = /^sub:(-?\d+)$/.exec(p ?? '');
  return match ? Number(match[1]) : null;
}

/** A Stars subscription link for this group. */
export const invoiceLink = (chat) => api.createInvoiceLink({
  title: 'SumUp — 1 month',
  description: `Payment reports for "${chat.title ?? 'this group'}", renewed every 30 days.`,
  payload: payload(chat.id),
  currency: 'XTR',
  prices: [{ label: '1 month', amount: SUBSCRIPTION_STARS }],
  subscription_period: PERIOD,
});

/** pay: paymentSettings() */
export const priceLabel = (months, pay) => BILLING_MODE === 'stars'
  ? `${SUBSCRIPTION_STARS * months} ⭐`
  : `${pay.currency === 'USD' ? '$' : '៛'}${money(pay.price * months)}`;

/**
 * The subscription screen: status and end date, then how to pay — the QR
 * photo (if one was set with /setqr) and account details (manual), or a
 * Subscribe link (Stars, unless a subscription is already renewing).
 * Returns { text, parse_mode, reply_markup, photo? }; text is HTML.
 */
export async function subscriptionScreen(chat, group) {
  if (group?.lifetime) {
    return {
      text: '<b>⭐ ការជាវប្រចាំខែ</b>\n♾️ ក្រុមនេះមានសិទ្ធិប្រើប្រាស់ជាអចិន្ត្រៃយ៍ — មិនចាំបាច់បង់ប្រាក់ទេ។',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'BACK' }]] },
    };
  }
  const latest = group && (await latestSubscription(group.id));
  const active = latest && latest.endDate >= now();
  const renewing = group?.billingStatus === 'active';
  const pay = await paymentSettings();

  const lines = ['<b>⭐ ការជាវប្រចាំខែ</b>'];
  if (active) lines.push(`សុពលភាពដល់: ${formatKhmerDate(dayOf(latest.endDate))}${latest.isTrial ? ' (សាកល្បង)' : ''}`);
  else lines.push('⚠️ មិនទាន់ជាវ ឬផុតកំណត់');
  if (renewing) lines.push('🔁 បន្តដោយស្វ័យប្រវត្តិ (Telegram Stars)');
  if (group?.billingStatus === 'canceled') lines.push('⏹ បានបោះបង់ — មិនបន្តទៀតទេ');
  if (group?.billingStatus === 'failed') lines.push('❌ ការបង់ប្រាក់បន្តមិនបានសម្រេច');
  const rows = [];
  if (BILLING_MODE === 'stars') {
    lines.push('', `តម្លៃ: ${priceLabel(1, pay)} / ៣០ ថ្ងៃ / ក្រុម`);
    if (!renewing) rows.push([{ text: `⭐ ជាវ ${SUBSCRIPTION_STARS} Stars`, url: await invoiceLink(chat), style: 'success' }]);
    rows.push([{ text: '📄 /terms', callback_data: 'TERMS' }, { text: '🆘 Support', url: pay.supportLink }]);
  } else {
    lines.push(
      '',
      `តម្លៃ: <b>${esc(priceLabel(1, pay))}</b> / ខែ / ក្រុម`,
      '',
      `🏦 ${esc(pay.bank)}`,
      `👤 ${esc(pay.accountName)}`,
      `💳 <code>${esc(pay.accountNumber)}</code>`,
      '',
      esc(pay.instructions),
    );
    rows.push([
      { text: '📋 ចម្លងលេខគណនី', copy_text: { text: pay.accountNumber.replace(/\s/g, '') } },
      { text: '💬 ផ្ញើវិក្កយបត្រ', url: pay.supportLink, style: 'success' },
    ]);
    rows.push([{ text: '📄 /terms', callback_data: 'TERMS' }]);
  }
  if (active) rows.push([{ text: '⬅️ ត្រឡប់ក្រោយ', callback_data: 'BACK' }]);

  const photo = BILLING_MODE === 'manual' ? await getSetting('payment_qr') : null;
  return { text: lines.join('\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: rows }, ...(photo && { photo }) };
}

/**
 * What the /menu title shows about access: { kind: 'lifetime' } or
 * { kind: 'trial' | 'paid' | 'renewing', end, daysLeft }; null if access has ended.
 */
export async function accessStatus(group) {
  if (group.lifetime) return { kind: 'lifetime' };
  const latest = await latestSubscription(group.id);
  if (!latest || latest.endDate < now()) return null;
  const kind = group.billingStatus === 'active' ? 'renewing' : latest.isTrial ? 'trial' : 'paid';
  return { kind, end: latest.endDate, daysLeft: Math.ceil((latest.endDate - now()) / 86400) };
}

/** pre_checkout_query: must be answered within 10 seconds. */
export async function approveCheckout(query) {
  const ok = BILLING_MODE === 'stars' && query.currency === 'XTR' && query.total_amount === SUBSCRIPTION_STARS
    && groupFromPayload(query.invoice_payload) !== null;
  await api.answerPreCheckoutQuery({
    pre_checkout_query_id: query.id,
    ok,
    error_message: ok ? undefined : 'This invoice is out of date. Please open a new one with /menu.',
  });
}

/** message.successful_payment: the first payment or a monthly renewal. */
export async function recordPayment(message) {
  const p = message.successful_payment;
  const groupTgId = groupFromPayload(p.invoice_payload);
  if (groupTgId === null) return;

  // Paying for a group that was never registered registers it (no trial: it's paid).
  let group = await getGroup(groupTgId);
  if (!group) {
    const chat = await api.getChat({ chat_id: groupTgId }).catch(() => null);
    group = await upsertGroup(groupTgId, chat?.title ?? null, { trial: false });
  }

  const endDate = p.subscription_expiration_date ?? now() + PERIOD;
  const isNew = await recordStarsPayment(group.id, {
    chargeId: p.telegram_payment_charge_id,
    payerId: message.from.id,
    amount: p.total_amount,
    endDate,
  });
  if (!isNew) return; // duplicate delivery
  await setBillingStatus(group.id, 'active', message.from.id);

  const until = formatKhmerDate(dayOf(endDate));
  await api.sendMessage({ chat_id: message.chat.id, text: `✅ អរគុណ! ក្រុម "${group.name ?? groupTgId}" អាចប្រើបានដល់ ${until}។` });
  if (!p.is_recurring || p.is_first_recurring) {
    await api.sendMessage({ chat_id: groupTgId, text: `✅ ការជាវត្រូវបានធ្វើឱ្យសកម្ម ដល់ ${until}។ ប្រើ /menu ដើម្បីមើលរបាយការណ៍។` }).catch(() => {});
  }
}

/** subscription update: the payer cancelled, re-enabled, or a renewal failed. */
export async function updateSubscription(update) {
  const groupTgId = groupFromPayload(update.invoice_payload);
  const group = groupTgId !== null && (await getGroup(groupTgId));
  if (!group) return;
  await setBillingStatus(group.id, update.state, update.user.id);
  if (update.state === 'failed') {
    await api.sendMessage({ chat_id: groupTgId, text: '❌ ការបង់ប្រាក់ប្រចាំខែមិនបានសម្រេច។ ប្រើ /menu → ⭐ ដើម្បីជាវម្ដងទៀត។' }).catch(() => {});
  }
}
