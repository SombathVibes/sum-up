// Payment settings for the Mini App (super admins): the current values, the
// config.js defaults, and whether a payment QR is set (/setqr in chat).

import { BILLING_MODE } from '../lib/config.js';
import { requireSuper } from '../lib/endpoint.js';
import { paymentDefaults, paymentSettings } from '../lib/settings.js';
import { getSetting } from '../lib/store.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  return {
    payment: await paymentSettings(),
    defaults: paymentDefaults(),
    billingMode: BILLING_MODE,
    hasQr: !!(await getSetting('payment_qr')),
  };
}
