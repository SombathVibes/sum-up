// Small Bot API helpers shared by the handlers.

import { api, BotApiError } from 'sdk';
import { ADMIN_IDS } from './config.js';
import { paymentSettings } from './settings.js';
import { latestTgMessageId } from './store.js';

let me;
export const getMe = async () => (me ??= await api.getMe());


/**
 * '/menu@sumup_bot args' → 'menu'. Returns null for non-commands and for
 * commands addressed to a different bot.
 */
export async function parseCommand(text) {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s|$)/i.exec(text ?? '');
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== (await getMe()).username.toLowerCase()) return null;
  return match[1].toLowerCase();
}

const notModified = (e) => e instanceof BotApiError && e.description?.includes('message is not modified');

/**
 * editMessageText that ignores "message is not modified". With extra.rich
 * (rich-message HTML, lib/rich.js) the message becomes a rich message; if
 * Telegram refuses that, `text` (the ordinary HTML form) is used instead.
 */
export async function edit(chatId, messageId, text, extra = {}) {
  const { rich, parse_mode, ...rest } = extra;
  if (rich) {
    try {
      return await api.editMessageText({ chat_id: chatId, message_id: messageId, rich_message: { html: rich }, ...rest });
    } catch (e) {
      if (notModified(e)) return undefined;
      console.error('rich edit refused, sending the text form:', e.description ?? e.message);
    }
  }
  try {
    return await api.editMessageText({ chat_id: chatId, message_id: messageId, text, parse_mode, ...rest });
  } catch (e) {
    if (!notModified(e)) throw e;
    return undefined;
  }
}

export async function deleteQuietly(chatId, messageId) {
  try {
    await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
}

/**
 * Sends a { text, parse_mode, reply_markup, photo?, rich? } screen; with a
 * photo the text is its caption; with `rich` it goes as a rich message (the
 * text form if that's refused).
 */
export async function sendScreen(chatId, { photo, text, rich, ...extra }) {
  if (photo) return api.sendPhoto({ chat_id: chatId, photo, caption: text, ...extra });
  if (rich) {
    const { parse_mode, ...rest } = extra;
    try {
      return await api.sendRichMessage({ chat_id: chatId, rich_message: { html: rich }, ...rest });
    } catch (e) {
      console.error('rich message refused, sending the text form:', e.description ?? e.message);
    }
  }
  return api.sendMessage({ chat_id: chatId, text, ...extra });
}

export const sendSupport = async (chatId) =>
  api.sendMessage({
    chat_id: chatId,
    text: `សម្រាប់បញ្ហាការបង់ប្រាក់ សូមទាក់ទងយើងខ្ញុំតាមរយៈ Telegram៖ ${(await paymentSettings()).supportLink}\n(Telegram support មិនអាចជួយការទិញក្នុង bot នេះបានទេ)`,
  });

const MENU_COMMAND = { command: 'menu', description: 'របាយការណ៍ប្រតិបត្តិការ' };
const SYNC_COMMAND = { command: 'sync', description: 'Sync & subscription (admin)' };
// Telegram requires /paysupport for bots that sell with Stars; /terms is recommended.
const PUBLIC_COMMANDS = [
  MENU_COMMAND,
  { command: 'terms', description: 'Subscription terms' },
  { command: 'paysupport', description: 'Help with a payment' },
];

const memberScope = (chatId, userId) => ({ type: 'chat_member', chat_id: chatId, user_id: userId });

/**
 * The "/" command list: everyone sees /menu; in this group super admins and
 * the group's managers also see /sync. Someone who isn't a member is skipped.
 */
export async function setCommands(chatId, managerIds = []) {
  await api.setMyCommands({ commands: PUBLIC_COMMANDS });
  for (const userId of new Set([...ADMIN_IDS, ...managerIds])) {
    try {
      await api.setMyCommands({
        commands: [...PUBLIC_COMMANDS, SYNC_COMMAND],
        scope: memberScope(chatId, userId),
      });
    } catch (e) {
      if (!(e instanceof BotApiError)) throw e;
      console.warn(`setMyCommands for admin ${userId} in ${chatId}: ${e.description}`);
    }
  }
}

/** Drops a user's own command list in a group (they go back to the public one). */
export async function clearCommands(chatId, userId) {
  try {
    await api.deleteMyCommands({ scope: memberScope(chatId, userId) });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
}

/**
 * '🏪 <b>Shop name</b>' for the private panel, linking to the group when
 * Telegram allows it: t.me/<username> for public groups, or the latest stored
 * message for private supergroups (members can open it). Basic groups have no link.
 */
// A group's public @username (or none), kept for a while: getChat costs a
// Telegram round trip (~220 ms) on every open of a group in the panel.
const CHAT_MS = 10 * 60 * 1000;
const chatNames = new Map(); // tgId → { at, username }
async function chatUsername(tgId) {
  const hit = chatNames.get(tgId);
  if (hit && Date.now() - hit.at < CHAT_MS) return hit.username;
  const chat = await api.getChat({ chat_id: tgId }).catch(() => null);
  if (chat) chatNames.set(tgId, { at: Date.now(), username: chat.username ?? null });
  return chat?.username ?? null;
}

export async function groupTitle(group) {
  const name = String(group.name ?? group.tgId).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let url = null;
  const [username, latest] = await Promise.all([
    chatUsername(group.tgId),
    String(group.tgId).startsWith('-100') ? latestTgMessageId(group.id) : 0,
  ]);
  if (username) url = `https://t.me/${username}`;
  else if (String(group.tgId).startsWith('-100')) {
    if (latest) url = `https://t.me/c/${String(group.tgId).slice(4)}/${latest}`;
  }
  return url ? `🏪 <b><a href="${url}">${name}</a></b>` : `🏪 <b>${name}</b>`;
}
