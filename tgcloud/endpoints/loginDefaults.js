// Saves the API URL, Basic value and headers new lottery logins start from
// (super admins): then adding a login is just a username and password.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { saveLoginDefaults } from '../lib/logins.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const { values, error } = await saveLoginDefaults(input.defaults ?? {});
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error });
  return { defaults: values };
}
