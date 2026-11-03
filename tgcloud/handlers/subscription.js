// A payer cancelled or re-enabled their Stars subscription, or a renewal failed.

import { updateSubscription } from '../lib/billing.js';

export default async function (update) {
  await updateSubscription(update);
}
