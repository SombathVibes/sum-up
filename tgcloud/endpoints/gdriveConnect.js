// ☁️ A Google sign-in link: after approving, the account is saved and this
// group switched to it (lib/gdrive.js finishConnect, via /gdrive/callback).

import { EndpointError } from 'sdk';
import { requireGroup } from '../lib/endpoint.js';
import { authLink, gdriveReady } from '../lib/gdrive.js';

export default async function (input, ctx) {
  const { user, group } = await requireGroup(ctx, input.groupId, 'manage');
  if (!gdriveReady()) throw new EndpointError('Google Drive isn’t set up on the server yet.', { code: 'NOT_READY' });
  return { url: await authLink(ctx.origin, user.id, group.id) };
}
