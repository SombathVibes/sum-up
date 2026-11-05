// Copy this file to tgcloud/lib/config.js and fill in your values. That file is git-ignored
// but still deployed by `npx tgcloud push`.

// Telegram user ids allowed to run /sync.
export const ADMIN_IDS = [541044465];

// Payment bots whose messages are summed: Telegram user id → display name.
export const WHITELIST_BOTS = {
  1148497258: 'ABA',
  1545555124: 'ACLEDA',
  6336847041: 'WING',
};

// The sync helper (see sync-helper/) and the shared secret it expects.
export const SYNC_HELPER_URL = 'https://sumup-sync.<your-subdomain>.workers.dev';
export const SYNC_HELPER_SECRET = 'change-me';

// The admin Mini App's address: https://app<app_id>.tgcloud.ai/ (printed by
// `npm run deploy`), or an https tunnel to `npm run dev` for local testing.
// Empty = no 🖥 Admin app button in the private panel.
export const MINIAPP_URL = '';

export const SUPPORT_LINK = 'https://t.me/sumupsp';
export const TRIAL_MONTHS = 1;

// 'manual': customers pay you outside Telegram (e.g. ABA KHQR) and an admin
// records it in /sync → Renew. 'stars': customers subscribe in-app with
// Telegram Stars (see README → Billing). Stars is off for now.
export const BILLING_MODE = 'manual';

// Manual billing: monthly price per group, in cents of MANUAL_CURRENCY.
export const MONTHLY_PRICE_CENTS = 500; // $5.00
export const MANUAL_CURRENCY = 'USD';
// Percent off for paying several months at once (changeable in the Mini App ⚙️).
export const DISCOUNTS = { 3: 10, 6: 15, 12: 25 };
// Where customers pay. Shown on the subscription screen with the QR image
// (an admin sends the QR photo to the bot with the caption /setqr).
export const PAYMENT_BANK = 'ABA';
export const PAYMENT_ACCOUNT_NAME = 'YOUR NAME';      // placeholder
export const PAYMENT_ACCOUNT_NUMBER = '000 000 000';  // placeholder
export const PAYMENT_INSTRUCTIONS = `បន្ទាប់ពីបង់ប្រាក់ សូមផ្ញើរូបវិក្កយបត្រ និងឈ្មោះក្រុមមកកាន់យើងខ្ញុំ។ យើងខ្ញុំនឹងបើកការប្រើប្រាស់ឆាប់ៗ។`;

// Stars billing: monthly price per group in Telegram Stars (Telegram renews every 30 days; max 10000).
export const SUBSCRIPTION_STARS = 500;

// Shown by /terms (Telegram requires this for Stars sales). Replace with your own.
export const TERMS_TEXT = `SumUp subscription terms (placeholder — replace before going live)

• One subscription covers one Telegram group for the months paid.
• Reports stop when the paid period ends; payments keep being recorded.
• Payment problems: /paysupport.`;
