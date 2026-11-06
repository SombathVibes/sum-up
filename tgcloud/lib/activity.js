// 📜 The activity log: who changed what (logins, groups' lottery and auto-send
// settings, platforms, payment settings, renewals, the team), for super
// admins in the Mini App. Writing it never fails the change it describes.

import { db } from 'sdk';
import { desc, lt } from 'sdk/db';
import { activity } from '../schema.js';
import { now } from './dates.js';

const KEEP_DAYS = 90;

const nameOf = (user) => (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : String(user.id ?? '')) : '');

/** Records one change by `user` (a Telegram user, or { id } only). */
export async function logActivity(user, action, target = '', detail = '') {
  try {
    await db.insert(activity).values({
      at: now(),
      userId: Number(user?.id) || 0,
      userName: nameOf(user).slice(0, 80),
      action,
      target: String(target ?? '').slice(0, 200),
      detail: String(detail ?? '').slice(0, 500),
    }).run();
  } catch (e) {
    console.error('activity log', action, e?.message ?? e);
  }
}

/** The latest changes, newest first. */
export const recentActivity = (limit = 200) => db.select().from(activity).orderBy(desc(activity.at)).limit(limit).all();

/** Drops entries older than KEEP_DAYS (the cron, once a day is plenty). */
export const pruneActivity = () => db.delete(activity).where(lt(activity.at, now() - KEEP_DAYS * 86400)).run();
