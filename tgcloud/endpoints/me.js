// Who is using the admin Mini App, and whether they're a super admin.

import { requireAdmin } from '../lib/endpoint.js';
import { isSuper } from '../lib/roles.js';
import { getMe } from '../lib/telegram.js';

export default async function (input, ctx) {
  const user = await requireAdmin(ctx);
  return {
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(' '),
    username: user.username ?? null,
    superAdmin: await isSuper(user),
    botUsername: (await getMe()).username, // for t.me/<bot>?start=addadmin
  };
}
