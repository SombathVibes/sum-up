// ⚠️ Alerts, each to whoever set the thing up and each on its own (one failing
// never stops the others or the run that called it):
//   - a lottery login's scheduled run failed → its owner (super admins for the
//     logins they added before owners were kept), once a day per login;
//   - a group's member's day went past ± the auto-send alert amount → whoever
//     saved that group's auto-send settings, once a day;
//   - a group's subscription ends in 3 days, and in 1 → the group itself
//     (it's the one that pays), once each, from 09:00.

import { api, db } from 'sdk';
import { and, eq, gt, ne } from 'sdk/db';
import { groupAutoSend } from '../schema.js';
import { accessStatus } from './billing.js';
import { ADMIN_IDS } from './config.js';
import { dailyConfig, reportForDay, snapshotWinLose } from './daily.js';
import { dayKey, dayOf, pad2, today } from './dates.js';
import { nowHHMM } from './logins.js';
import { getGroupById, getSetting, listGroups, setSetting } from './store.js';

const riel = (n) => Math.round(n).toLocaleString('en-US');

async function tell(chatId, text) {
  try {
    await api.sendMessage({ chat_id: chatId, text: text.slice(0, 4000) });
  } catch (e) {
    console.error('alert to', chatId, e?.message ?? e);
  }
}

/** Once per `key` per day: true the first time today (and remembers it). */
async function firstToday(key) {
  const day = dayKey(today());
  if ((await getSetting(key)) === day) return false;
  await setSetting(key, day);
  return true;
}

/** After the scheduled runs (runDue's result): failed logins → their owners. */
export async function alertRunProblems(ran) {
  for (const { login, reports, totalsError } of ran) {
    try {
      const failed = reports.filter((r) => !r.ok);
      if (!failed.length && !totalsError) continue;
      if (!(await firstToday(`alert:login:${login.id}`))) continue;
      const lines = [
        ...failed.slice(0, 5).map((x) => `• ${x.who?.name || x.subject || 'ទាំងអស់'}: ${x.error ?? 'error'}`),
        ...(totalsError ? [`• សរុប: ${totalsError}`] : []),
      ];
      const to = login.ownerId ? [login.ownerId] : ADMIN_IDS;
      for (const id of to) await tell(id, `⚠️ 🔑 Login ${login.username}: ការទាញតាមម៉ោងមានបញ្ហា\n${lines.join('\n')}\n\nពិនិត្យ Password ឬ ចុច «🔄 ពិនិត្យ» នៅ Mini App → 🔑 Login។`);
    } catch (e) {
      console.error('login alert', login?.id, e?.message ?? e);
    }
  }
}

/** Groups whose member's day (final: less 📤 សាង) went past ± their alert amount → whoever set it. */
export async function checkBigDays() {
  const day = dayKey(today());
  const rows = await db.select().from(groupAutoSend)
    .where(and(gt(groupAutoSend.alertAmount, 0), ne(groupAutoSend.alertedDay, day))).all();
  for (const row of rows) {
    try {
      if (!row.setBy) continue;
      const cfg = await dailyConfig(row.groupId);
      if (!cfg.enabled || !cfg.loginId || !cfg.memberCode) continue;
      const final = snapshotWinLose(await reportForDay(cfg.loginId, day, cfg.memberCode));
      if (final === null || Math.abs(final) < row.alertAmount) continue;
      await db.update(groupAutoSend).set({ alertedDay: day }).where(eq(groupAutoSend.groupId, row.groupId)).run();
      const group = await getGroupById(row.groupId);
      await tell(row.setBy, `${final < 0 ? '🔻' : '🔺'} 🏪 ${group?.name ?? row.groupId} · 👤 ${cfg.memberName || cfg.memberCode}\nថ្ងៃនេះ ៛${riel(final)} — លើស ±៛${riel(row.alertAmount)} ដែលបានកំណត់។`);
    } catch (e) {
      console.error('big-day alert', row.groupId, e?.message ?? e);
    }
  }
}

/** From 09:00: groups whose subscription ends in 3 days, or in 1 → a reminder in the group, once each. */
export async function remindRenewals() {
  if (nowHHMM() < '09:00') return;
  for (const group of await listGroups()) {
    try {
      if (group.lifetime) continue;
      const status = await accessStatus(group);
      if (!status || ![3, 1].includes(status.daysLeft)) continue;
      const key = `remind:${group.id}:${status.end}:${status.daysLeft}`;
      if (await getSetting(key)) continue;
      await setSetting(key, '1');
      const end = dayOf(status.end);
      await tell(group.tgId, `⏰ ការជាវរបស់ក្រុមនេះនឹងផុតកំណត់ថ្ងៃ ${pad2(end.d)}/${pad2(end.m)}/${end.y} (នៅសល់ ${status.daysLeft} ថ្ងៃ)។\nចុច /menu → ⭐ ការជាវ ដើម្បីបន្ត។`);
    } catch (e) {
      console.error('renew reminder', group.id, e?.message ?? e);
    }
  }
}
