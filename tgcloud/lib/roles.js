// Who may do what. Super admins (admins.is_super; ADMIN_IDS in config are
// always super) can do everything, including managing admins. Other admins
// are added by a super admin and get a role per group: 'view' (reports in
// their private panel) or 'manage' (also Sync, Renew and History). Everyone
// else just uses the group's reports.

import { api, db } from 'sdk';
import { and, asc, eq } from 'sdk/db';
import { adminGroups, admins } from '../schema.js';
import { ADMIN_IDS } from './config.js';
import { getGroup, listGroups } from './store.js';

/** Config super admins can't be demoted or removed from inside the bot. */
export const isConfigSuper = (userId) => ADMIN_IDS.includes(userId);

export async function isSuper(user) {
  if (!user) return false;
  if (isConfigSuper(user.id)) return true;
  const row = await getAdmin(user.id);
  // A row copied from config (added_by 0) stops counting once the id leaves ADMIN_IDS.
  return !!row?.isSuper && row.addedBy !== 0;
}

/**
 * Copies ADMIN_IDS into the admins table as super admins, with their current
 * Telegram name. Run when the team list opens.
 */
export async function syncConfigSupers() {
  // Rows copied from config for ids no longer in ADMIN_IDS are removed.
  for (const row of await db.select().from(admins).where(eq(admins.addedBy, 0)).all()) {
    if (!isConfigSuper(row.userId)) await removeAdmin(row.userId);
  }
  for (const userId of ADMIN_IDS) {
    const chat = await api.getChat({ chat_id: userId }).catch(() => null);
    const existing = await getAdmin(userId);
    const name = chat ? [chat.first_name, chat.last_name].filter(Boolean).join(' ') || null : existing?.name ?? null;
    const username = chat?.username ?? existing?.username ?? null;
    await db.insert(admins)
      .values({ userId, name, username, isSuper: true, addedBy: 0 })
      .onConflictDoUpdate({ target: admins.userId, set: { name, username, isSuper: true } })
      .run();
  }
}

export const setSuper = (userId, isSuper) =>
  db.update(admins).set({ isSuper }).where(eq(admins.userId, userId)).run();

/** 'super' | 'manage' | 'view' | null for this user in the group with this Telegram id. */
export async function roleIn(user, groupTgId) {
  if (!user) return null;
  const [sup, group] = await Promise.all([isSuper(user), getGroup(groupTgId)]);
  if (sup) return 'super';
  if (!group) return null;
  const row = await db.select().from(adminGroups)
    .where(and(eq(adminGroups.userId, user.id), eq(adminGroups.groupId, group.id)))
    .get();
  return row?.role ?? null;
}

export const canManage = (role) => role === 'super' || role === 'manage';
export const canView = (role) => !!role;

/** Groups this user sees in the private panel, each with their role. */
export async function visibleGroups(user) {
  const all = await listGroups();
  if (await isSuper(user)) return all.map((group) => ({ group, role: 'super' }));
  const roles = await rolesOf(user.id);
  return all.filter((g) => roles.has(g.id)).map((group) => ({ group, role: roles.get(group.id) }));
}

export const listAdmins = () => db.select().from(admins).orderBy(asc(admins.name)).all();
export const getAdmin = (userId) => db.select().from(admins).where(eq(admins.userId, userId)).get();

export const addAdmin = ({ userId, name, username, addedBy }) => db.insert(admins)
  .values({ userId, name, username, addedBy })
  .onConflictDoUpdate({ target: admins.userId, set: { name, username } })
  .run();

/** Removes an admin and all their group assignments. */
export async function removeAdmin(userId) {
  await db.delete(adminGroups).where(eq(adminGroups.userId, userId)).run();
  await db.delete(admins).where(eq(admins.userId, userId)).run();
}

/** groupId (groups.id) → 'view' | 'manage' for one admin. */
export async function rolesOf(userId) {
  const rows = await db.select().from(adminGroups).where(eq(adminGroups.userId, userId)).all();
  return new Map(rows.map((r) => [r.groupId, r.role]));
}

/** Sets an admin's role in a group; null removes it. */
export async function setGroupRole(userId, groupId, role) {
  await db.delete(adminGroups).where(and(eq(adminGroups.userId, userId), eq(adminGroups.groupId, groupId))).run();
  if (role) await db.insert(adminGroups).values({ userId, groupId, role }).run();
}

/** User ids that manage a group (for its command list), besides super admins. */
export async function managersOf(groupId) {
  const rows = await db.select({ userId: adminGroups.userId }).from(adminGroups)
    .where(and(eq(adminGroups.groupId, groupId), eq(adminGroups.role, 'manage')))
    .all();
  return rows.map((r) => r.userId);
}
