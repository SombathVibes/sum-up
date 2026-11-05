// Payment details shown on ⭐ ការជាវ and used when recording a renewal.
// config.js holds the defaults; super admins can change them in the Mini App,
// which keeps only the fields that differ from config under settings 'payment'.

import * as config from './config.js';
import { getSetting, setSetting } from './store.js';

// Discounts for paying several months at once, in percent off (months → %).
export const DISCOUNT_MONTHS = [3, 6, 12];

const DEFAULTS = {
  price: config.MONTHLY_PRICE_CENTS, // per month, in hundredths of `currency`
  currency: config.MANUAL_CURRENCY,
  bank: config.PAYMENT_BANK,
  accountName: config.PAYMENT_ACCOUNT_NAME,
  accountNumber: config.PAYMENT_ACCOUNT_NUMBER,
  instructions: config.PAYMENT_INSTRUCTIONS,
  supportLink: config.SUPPORT_LINK,
  discounts: config.DISCOUNTS ?? { 3: 10, 6: 15, 12: 25 },
};

const TEXT_LIMITS = { bank: 40, accountName: 60, accountNumber: 40, instructions: 500, supportLink: 200 };

/** { price, currency, bank, accountName, accountNumber, instructions, supportLink, discounts: { 3, 6, 12 → % } } */
export async function paymentSettings() {
  let saved = {};
  try {
    saved = JSON.parse((await getSetting('payment')) ?? '{}');
  } catch {
    // A broken value falls back to config.
  }
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (key in saved) out[key] = saved[key];
  return out;
}

/**
 * Checks new values (price in hundredths) and returns them cleaned, or
 * { error } naming the first bad field.
 */
export function checkPayment(input) {
  const out = {};
  const price = Number(input.price);
  if (!Number.isInteger(price) || price <= 0 || price > 1e10) return { error: 'price' };
  out.price = price;
  if (!['USD', 'KHR'].includes(input.currency)) return { error: 'currency' };
  out.currency = input.currency;
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const value = String(input[key] ?? '').trim();
    if (!value || value.length > max) return { error: key };
    out[key] = value;
  }
  if (!/^https:\/\/\S+$/.test(out.supportLink)) return { error: 'supportLink' };
  // Whole percents, 0 (none) to 90.
  out.discounts = {};
  for (const m of DISCOUNT_MONTHS) {
    const pct = Number(input.discounts?.[m] ?? 0);
    if (!Number.isInteger(pct) || pct < 0 || pct > 90) return { error: 'discounts' };
    out.discounts[m] = pct;
  }
  return { values: out };
}

export async function savePaymentSettings(values) {
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => k in DEFAULTS && JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])));
  await setSetting('payment', JSON.stringify(changed));
}

export const paymentDefaults = () => ({ ...DEFAULTS });
