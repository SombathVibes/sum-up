// ☁️ A Microsoft sign-in link: after approving, the account is saved and this
// group switched to it (lib/onedrive.js finishConnect, via /onedrive/callback).

import { EndpointError } from 'sdk';
import { requireGroup } from '../lib/endpoint.js';
import { authLink, onedriveReady } from '../lib/onedrive.js';

export default async function (input, ctx) {
  const { user, group } = await requireGroup(ctx, input.groupId, 'manage');
  if (!onedriveReady()) throw new EndpointError('OneDrive isn’t set up on the server yet.', { code: 'NOT_READY' });
  return { url: await authLink(ctx.origin, user.id, group.id) };
}
