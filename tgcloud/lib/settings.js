// Payment details shown on ⭐ ការជាវ and used when recording a renewal.
// config.js holds the defaults; super admins can change them in the Mini App,
// which keeps only the fields that differ from config under settings 'payment'.

import {
  MANUAL_CURRENCY, MONTHLY_PRICE_CENTS, PAYMENT_ACCOUNT_NAME, PAYMENT_ACCOUNT_NUMBER, PAYMENT_BANK,
  PAYMENT_INSTRUCTIONS, SUPPORT_LINK,
} from './config.js';
import { getSetting, setSetting } from './store.js';

const DEFAULTS = {
  price: MONTHLY_PRICE_CENTS, // per month, in hundredths of `currency`
  currency: MANUAL_CURRENCY,
  bank: PAYMENT_BANK,
  accountName: PAYMENT_ACCOUNT_NAME,
  accountNumber: PAYMENT_ACCOUNT_NUMBER,
  instructions: PAYMENT_INSTRUCTIONS,
  supportLink: SUPPORT_LINK,
};

const TEXT_LIMITS = { bank: 40, accountName: 60, accountNumber: 40, instructions: 500, supportLink: 200 };

/** { price, currency, bank, accountName, accountNumber, instructions, supportLink } */
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
  return { values: out };
}

export async function savePaymentSettings(values) {
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => k in DEFAULTS && v !== DEFAULTS[k]));
  await setSetting('payment', JSON.stringify(changed));
}

export const paymentDefaults = () => ({ ...DEFAULTS });
