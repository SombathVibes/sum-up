// 📤 Auto-send: at a group's chosen time each day the bot posts today's report
// for the agents picked for it — the 🖼 album (day sheet + member report) and/or
// the month's 📊 Excel — into the group (the cron, every minute: runAutoSends).
// Set in the Mini App (the group's 📥 ឆ្នោត tab) by a super admin or a manager
// of the group with their own login. Each group, and each agent in it, is
// sent on its own: one failing doesn't stop the others, and what failed goes
// to whoever set it up, privately.

import { api, db, InputFile, renderImages } from 'sdk';
import { and, eq, lte, ne } from 'sdk/db';
import { groupAutoSend } from '../schema.js';
import { agentDayImages, getAgent, sendAgentExcel } from './agents.js';
import { dailyConfig } from './daily.js';
import { dayKey, today } from './dates.js';
import { getLogin, nowHHMM } from './logins.js';
import { getGroupById, hasActiveSubscription } from './store.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_AGENTS = 10;
export const AUTO_DEFAULTS = { enabled: false, time: '21:00', agentIds: [], sendImage: true, sendExcel: false, alertAmount: 0, setBy: 0 };

const parseIds = (text) => {
  try {
    const ids = JSON.parse(text || '[]');
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
};

/** A group's auto-send settings (defaults when never set). */
export async function autoSendConfig(groupId) {
  const r = await db.select().from(groupAutoSend).where(eq(groupAutoSend.groupId, groupId)).get();
  if (!r) return { ...AUTO_DEFAULTS };
  return { enabled: !!r.enabled, time: r.time, agentIds: parseIds(r.agentIds), sendImage: !!r.sendImage, sendExcel: !!r.sendExcel, alertAmount: r.alertAmount, setBy: r.setBy };
}

/** Checks new settings; `agentIds` must be among `allowed` (the group's login's agents). { values } or { error }. */
export function checkAutoSend(input, allowed) {
  const enabled = input.enabled === true;
  const time = String(input.time ?? '');
  if (!TIME.test(time)) return { error: 'time' };
  const ids = [...new Set((Array.isArray(input.agentIds) ? input.agentIds : []).map(Number))];
  if (ids.length > MAX_AGENTS || !ids.every((id) => allowed.has(id))) return { error: 'agents' };
  const sendImage = input.sendImage !== false;
  const sendExcel = input.sendExcel === true;
  if (enabled && (!ids.length || (!sendImage && !sendExcel))) return { error: enabled && !ids.length ? 'agents' : 'what' };
  const alertAmount = Math.round(Number(input.alertAmount) || 0);
  if (alertAmount < 0 || alertAmount > 1e12) return { error: 'alert' };
  return { values: { enabled, time, agentIds: ids, sendImage, sendExcel, alertAmount } };
}

/** Saves them; `setBy` (who saved) gets the alerts and the failures. */
export async function saveAutoSend(groupId, values, setBy) {
  const row = { ...values, agentIds: JSON.stringify(values.agentIds), setBy };
  await db.insert(groupAutoSend).values({ groupId, ...row })
    .onConflictDoUpdate({ target: groupAutoSend.groupId, set: row })
    .run();
}

/** Tells whoever set it up what went wrong (never throws). */
async function tell(userId, text) {
  if (!userId) return;
  await api.sendMessage({ chat_id: userId, text: text.slice(0, 4000) }).catch((e) => console.error('auto-send notice', userId, e?.message ?? e));
}

/** One agent's today into the group: the 🖼 album and/or the 📊 Excel. Returns problems ([] when all went). */
async function sendAgent(login, agent, chatId, day, { sendImage, sendExcel }) {
  const problems = [];
  if (sendImage) {
    try {
      const img = await agentDayImages(login, agent, day, renderImages, { refresh: true });
      if (img.text) problems.push(`🖼 ${agent.username}: ${img.text}`);
      else {
        const media = img.images.map((im, i) => ({ type: 'photo', media: im.fileId ?? `attach://p${i}`, ...(i === 0 ? { caption: img.caption } : {}) }));
        const files = Object.fromEntries(img.images.map((im, i) => [`p${i}`, im.fileId ? undefined : new InputFile(im.bytes, `${agent.username}-${day}-${i + 1}.png`, { type: 'image/png' })]));
        const sent = await api.sendMediaGroup({ chat_id: chatId, media, ...files });
        await Promise.all(sent.map((m, i) => !img.images[i].fileId && m.photo && img.images[i].remember(m.photo.at(-1).file_id)));
      }
    } catch (e) {
      problems.push(`🖼 ${agent.username}: ${String(e.message ?? e).slice(0, 200)}`);
    }
  }
  if (sendExcel) {
    try {
      const screen = await sendAgentExcel(login, agent, day.slice(0, 7), chatId, api, InputFile, true);
      if (!screen.text.startsWith('✅')) problems.push(`📊 ${agent.username}: ${screen.text}`);
    } catch (e) {
      problems.push(`📊 ${agent.username}: ${String(e.message ?? e).slice(0, 200)}`);
    }
  }
  return problems;
}

/** One group's auto-send for `day`. Returns problems. */
async function sendGroup(row, day) {
  const group = await getGroupById(row.groupId);
  if (!group) return [];
  const name = group.name ?? String(group.tgId);
  if (!(await hasActiveSubscription(group))) return [`🏪 ${name}: ការជាវផុតកំណត់ — មិនបានផ្ញើ។`];
  const cfg = await dailyConfig(group.id);
  const login = cfg.loginId ? await getLogin(cfg.loginId, { secret: true }) : null;
  if (!login) return [`🏪 ${name}: មិនមាន Login ឆ្នោត — មិនបានផ្ញើ។`];
  const problems = [];
  for (const id of parseIds(row.agentIds)) {
    const agent = await getAgent(id);
    if (!agent || agent.loginId !== login.id) {
      problems.push(`🏪 ${name}: ភ្នាក់ងារ #${id} មិននៅក្រោម Login នេះទៀតទេ។`);
      continue;
    }
    problems.push(...(await sendAgent(login, agent, group.tgId, day, row)));
  }
  return problems.map((p) => (p.startsWith('🏪') ? p : `🏪 ${name} · ${p}`));
}

/**
 * The cron: every group whose time has come today and hasn't been sent yet
 * (a missed minute catches up later the same day). Each is marked sent first,
 * so a slow run never sends twice.
 */
export async function runAutoSends() {
  const day = dayKey(today());
  const due = await db.select().from(groupAutoSend)
    .where(and(eq(groupAutoSend.enabled, true), ne(groupAutoSend.sentDay, day), lte(groupAutoSend.time, nowHHMM())))
    .all();
  let sent = 0;
  for (const row of due) {
    await db.update(groupAutoSend).set({ sentDay: day }).where(eq(groupAutoSend.groupId, row.groupId)).run();
    try {
      const problems = await sendGroup(row, day);
      if (problems.length) await tell(row.setBy, `⚠️ 📤 ផ្ញើស្វ័យប្រវត្តិ (${day}):\n${problems.join('\n')}`);
      sent += 1;
    } catch (e) {
      console.error('auto-send', row.groupId, e?.stack ?? e);
      await tell(row.setBy, `⚠️ 📤 ផ្ញើស្វ័យប្រវត្តិ (${day}): ${String(e.message ?? e).slice(0, 300)}`);
    }
  }
  return sent;
}
