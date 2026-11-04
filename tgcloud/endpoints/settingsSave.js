// Saves the payment settings (super admins). Price arrives in hundredths.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { checkPayment, paymentSettings, savePaymentSettings } from '../lib/settings.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const { values, error } = checkPayment(input.payment ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  await savePaymentSettings(values);
  return { payment: await paymentSettings() };
}
