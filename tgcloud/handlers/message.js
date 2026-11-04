// Payments posted by the bank bots (needs Bot-to-Bot Communication Mode and
// admin rights, see README), Stars subscription payments, and the commands
// /start, /menu, /sync, /terms, /paysupport and /setqr (super admins: payment QR photo).
// In a private chat, admins get their panel (lib/admin.js); see lib/roles.js for who may do what.

import { api } from 'sdk';
import { addPrompt, adminPanel, teamMemberScreen } from '../lib/admin.js';
import { accessStatus, recordPayment, subscriptionScreen } from '../lib/billing.js';
import { TERMS_TEXT, WHITELIST_BOTS } from '../lib/config.js';
import { dailyConfig, pushSchedule, runDue } from '../lib/daily.js';
import { parseAmount } from '../lib/parse.js';
import { getGroup, hasActiveSubscription, saveMessages, setSetting } from '../lib/store.js';
import { addAdmin, canManage, isSuper, roleIn } from '../lib/roles.js';
import { parseCommand, sendScreen, sendSupport } from '../lib/telegram.js';
import { menuKeyboard, menuText, syncMenu } from '../lib/ui.js';

export default async function (message) {
  // Never answer another bot: that is how bot-to-bot loops start.
  if (message.from?.is_bot) return savePayment(message);
  if (message.successful_payment) return recordPayment(message);
  // A super admin picked someone with the 'add admin' user picker.
  if (message.users_shared) return (await isSuper(message.from)) && addSharedAdmins(message);

  const command = await parseCommand(message.text ?? message.caption);
  if (!command) return;
  const chatId = message.chat.id;
  const inGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';

  try {
    // The Mini App's ➕ opens t.me/<bot>?start=addadmin: the user picker, for super admins.
    if (!inGroup && command === 'start' && /\saddadmin\s*$/.test(message.text ?? '') && (await isSuper(message.from))) {
      await addPrompt(chatId);
      return;
    }
    // Admins (super admins, and admins with at least one group) get their panel in a private chat.
    if (!inGroup && ['start', 'menu', 'admin'].includes(command)) {
      const panel = await adminPanel(message.from);
      if (panel) {
        await sendScreen(chatId, panel);
        return;
      }
    }
    // For everyone else reports and billing are per group; a private chat only does /terms and /paysupport.
    if (!inGroup && (command === 'menu' || command === 'sync')) {
      await api.sendMessage({ chat_id: chatId, text: 'សូមបញ្ចូល bot ទៅក្នុងក្រុម ហើយប្រើ /menu នៅទីនោះ។\nAdd me to a group and use /menu there.' });
      return;
    }

    switch (command) {
      case 'start':
        await api.sendMessage({ chat_id: chatId, text: 'Say hello to me' });
        break;

      case 'dailyrun': {
        // Sent by the sync helper's cron as its user account (a super admin), or typed by one.
        if (inGroup || !(await isSuper(message.from))) break;
        await api.deleteMessage({ chat_id: chatId, message_id: message.message_id }).catch(() => {});
        const ran = await runDue();
        await pushSchedule();
        // Quiet when everything worked; failures are worth a message.
        const failed = ran.filter((r) => !r.row.ok);
        if (failed.length) {
          await api.sendMessage({
            chat_id: chatId,
            text: `⚠️ Daily report: ${failed.length}/${ran.length} failed\n${failed.map((r) => `• ${r.group.name ?? r.group.tgId}: ${r.row.error}`).join('\n')}`,
          });
        }
        break;
      }

      case 'terms':
        await api.sendMessage({ chat_id: chatId, text: TERMS_TEXT });
        break;

      case 'paysupport':
        await sendSupport(chatId);
        break;

      case 'setqr': {
        // An admin sends the payment QR as a photo with the caption /setqr.
        if (!(await isSuper(message.from))) break;
        const photo = message.photo?.at(-1); // largest size
        if (!photo) {
          await api.sendMessage({ chat_id: chatId, text: 'Send the payment QR as a photo with the caption /setqr.' });
          break;
        }
        await setSetting('payment_qr', photo.file_id);
        await api.sendMessage({ chat_id: chatId, text: '✅ Payment QR saved. It now shows on ⭐ ការជាវ.' });
        break;
      }

      case 'menu': {
        const role = await roleIn(message.from, chatId);
        const group = await getGroup(chatId);
        if (!group || !(await hasActiveSubscription(group))) {
          // Managers land on the sync menu (register or renew); everyone else can subscribe.
          if (canManage(role)) await api.sendMessage({ chat_id: chatId, ...syncMenu(group?.lifetime, role === 'super') });
          else await sendScreen(chatId, await subscriptionScreen(message.chat, group));
          break;
        }
        const status = await accessStatus(group);
        const daily = (await dailyConfig(group.id)).enabled;
        await api.sendMessage({ chat_id: chatId, text: menuText(status), reply_markup: menuKeyboard(canManage(role), status, daily) });
        break;
      }

      case 'sync': {
        const role = await roleIn(message.from, chatId);
        if (!canManage(role)) {
          await api.sendMessage({ chat_id: chatId, text: 'You are not admin 😡' });
          break;
        }
        const group = await getGroup(chatId);
        await api.sendMessage({ chat_id: chatId, ...syncMenu(group?.lifetime, role === 'super') });
        break;
      }
    }
  } catch (e) {
    console.error(e);
    await api.sendMessage({ chat_id: chatId, text: '⚠️ Something went wrong. Please try again.' });
  }
}

/** Adds the users a super admin picked, then shows the first one's page. */
async function addSharedAdmins(message) {
  const picked = message.users_shared.users ?? [];
  for (const u of picked) {
    await addAdmin({
      userId: u.user_id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
      username: u.username ?? null,
      addedBy: message.from.id,
    });
  }
  await api.sendMessage({
    chat_id: message.chat.id,
    text: picked.length ? '✅ បានបន្ថែមអ្នកគ្រប់គ្រង។ ឥឡូវកំណត់ក្រុមខាងក្រោម។' : 'No user picked.',
    reply_markup: { remove_keyboard: true },
  });
  if (picked.length) await sendScreen(message.chat.id, await teamMemberScreen(picked[0].user_id));
}

/** Stores a bank bot's payment notification for a registered group. */
async function savePayment(message) {
  if (!(message.from.id in WHITELIST_BOTS)) return;
  const text = message.text ?? message.caption;
  const parsed = parseAmount(text);
  if (!parsed) return;

  const group = await getGroup(message.chat.id);
  if (!group || group.status !== 'active') return;

  await saveMessages(group.id, [{
    tgMessageId: message.message_id,
    botTgId: message.from.id,
    amount: parsed.amount,
    currency: parsed.currency,
    date: message.date,
    text,
  }]);
}
