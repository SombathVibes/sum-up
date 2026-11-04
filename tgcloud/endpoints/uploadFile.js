// Uploads the payment QR (an image) or the agent Excel template (.xlsx) from
// the Mini App (super admins), like /setqr and /settemplate in chat. The
// bytes arrive base64-encoded; the bot sends them once to the uploader's
// private chat to get a Telegram file_id (what the settings keep), then
// deletes that message.

import { api, EndpointError, InputFile } from 'sdk';
import { TEMPLATE_KEY, TEMPLATE_NAME_KEY, checkTemplate } from '../lib/agents.js';
import { requireSuper } from '../lib/endpoint.js';
import { setSetting } from '../lib/store.js';

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS = {
  qr: { types: ['image/jpeg', 'image/png'], send: 'sendPhoto', field: 'photo' },
  template: { types: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], send: 'sendDocument', field: 'document' },
};

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default async function (input, ctx) {
  const user = await requireSuper(ctx);
  const kind = KINDS[input.kind];
  if (!kind) throw new EndpointError('Unknown file kind.', { code: 'BAD_KIND' });
  const name = String(input.name ?? '').slice(0, 120) || (input.kind === 'qr' ? 'qr.png' : 'template.xlsx');
  let bytes;
  try {
    bytes = fromBase64(String(input.data ?? ''));
  } catch {
    throw new EndpointError('The file could not be read.', { code: 'BAD_DATA' });
  }
  if (!bytes.length || bytes.length > MAX_BYTES) throw new EndpointError('The file must be 5 MB or smaller.', { code: 'TOO_BIG' });

  let type;
  if (input.kind === 'qr') {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!png && !jpg) throw new EndpointError('The QR must be a PNG or JPG image.', { code: 'BAD_TYPE' });
    type = png ? 'image/png' : 'image/jpeg';
  } else {
    const problem = await checkTemplate(bytes);
    if (problem) throw new EndpointError(problem, { code: 'BAD_TEMPLATE' });
    [type] = kind.types;
  }

  // Telegram gives a file_id only for a sent file: send it privately, keep the id, remove the message.
  const msg = await api[kind.send]({ chat_id: user.id, [kind.field]: new InputFile(bytes, name, { type }), disable_notification: true });
  const fileId = input.kind === 'qr' ? msg.photo?.at(-1)?.file_id : msg.document?.file_id;
  await api.deleteMessage({ chat_id: user.id, message_id: msg.message_id }).catch(() => {});
  if (!fileId) throw new EndpointError('Telegram did not return the file.', { code: 'NO_FILE_ID' });

  if (input.kind === 'qr') await setSetting('payment_qr', fileId);
  else {
    await setSetting(TEMPLATE_KEY, fileId);
    await setSetting(TEMPLATE_NAME_KEY, name);
  }
  return { kind: input.kind, name };
}
