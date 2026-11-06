// Saves the 🌐 platforms (super admins): each a name, API URL, Basic value and
// headers; staff adding a login pick one and type a username and password.

import { EndpointError } from 'sdk';
import { requireSuper } from '../lib/endpoint.js';
import { savePlatforms } from '../lib/logins.js';

export default async function (input, ctx) {
  await requireSuper(ctx);
  const { values, error, index } = await savePlatforms(input.platforms ?? []);
  if (error) throw new EndpointError(`Check the ${error} field.`, { code: 'BAD_FIELD', field: error, index });
  return { platforms: values };
}
