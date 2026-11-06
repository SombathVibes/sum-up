// Saves the payment settings (super admins). Price arrives in hundredths.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { checkPayment, paymentSettings, savePaymentSettings } from '../lib/settings.js';
import { logActivity } from '../lib/activity.js';

export default async function (input, ctx) {
  const user = await requireSuper(ctx);
  const { values, error } = checkPayment(input.payment ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  await savePaymentSettings(values);
  await logActivity(user, 'settings.payment', 'ការបង់ប្រាក់', `${values.price / 100} ${values.currency} · ${values.bank}`);
  return { payment: await paymentSettings() };
}
