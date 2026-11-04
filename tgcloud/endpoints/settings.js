// Payment settings for the Mini App (super admins): the current values, the
// config.js defaults, and whether the payment QR and the agent Excel
// template are set (uploadFile, or /setqr and /settemplate in chat).

import { TEMPLATE_KEY, TEMPLATE_NAME_KEY } from '../lib/agents.js';
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
    template: (await getSetting(TEMPLATE_KEY)) ? (await getSetting(TEMPLATE_NAME_KEY)) ?? 'template.xlsx' : null,
  };
}
