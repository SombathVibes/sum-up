// Telegram asks before taking Stars for a subscription invoice.

import { approveCheckout } from '../lib/billing.js';

export default async function (query) {
  await approveCheckout(query);
}
