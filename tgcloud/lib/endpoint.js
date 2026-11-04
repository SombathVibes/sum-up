// Shared checks for the admin Mini App's endpoints (tgcloud/endpoints/). The
// platform has already verified ctx.initData, so ctx.initData.user really is the
// caller; what's left is whether they may see or change the group they ask for.

import { EndpointError } from 'sdk';
import { dayKey, parseDayKey, startOf } from './dates.js';
import { canManage, canView, isSuper, roleIn, visibleGroups } from './roles.js';
import { getGroup } from './store.js';

const MAX_DAYS = 366;

export function caller(ctx) {
  const user = ctx.initData?.user;
  if (!user?.id) throw new EndpointError('Open this from the bot in Telegram.', { code: 'NO_USER' });
  return user;
}

/** Super admins, and admins with at least one group, may use the Mini App. */
export async function requireAdmin(ctx) {
  const user = caller(ctx);
  if (!(await isSuper(user)) && !(await visibleGroups(user)).length) {
    throw new EndpointError('Only bot admins can use this app.', { code: 'FORBIDDEN' });
  }
  return user;
}

/** Super admins only: team and payment settings. */
export async function requireSuper(ctx) {
  const user = caller(ctx);
  if (!(await isSuper(user))) throw new EndpointError('Only super admins can do this.', { code: 'FORBIDDEN' });
  return user;
}

/** The group (by Telegram id) and the caller's role in it; `need` is 'view' or 'manage'. */
export async function requireGroup(ctx, groupTgId, need = 'view') {
  const user = caller(ctx);
  const tgId = Number(groupTgId);
  if (!Number.isSafeInteger(tgId) || tgId >= 0) throw new EndpointError('Unknown group.', { code: 'BAD_GROUP' });
  const role = await roleIn(user, tgId);
  const allowed = need === 'manage' ? canManage(role) : canView(role);
  const group = allowed ? await getGroup(tgId) : null;
  if (!group) throw new EndpointError('You can’t open this group.', { code: 'FORBIDDEN' });
  return { user, group, role };
}

/** 'YYYY-MM-DD'..'YYYY-MM-DD' (Phnom Penh days, inclusive) → { start, end, from, to } in unix seconds. */
export function parseRange(from, to) {
  const a = parseDayKey(String(from ?? ''));
  const b = parseDayKey(String(to ?? ''));
  if (!a || !b) throw new EndpointError('Pick a start and end date.', { code: 'BAD_RANGE' });
  const start = startOf(a);
  const end = startOf(b) + 86400 - 1;
  if (end < start) throw new EndpointError('The end date is before the start date.', { code: 'BAD_RANGE' });
  if ((end - start) / 86400 > MAX_DAYS) throw new EndpointError(`Pick ${MAX_DAYS} days or fewer.`, { code: 'BAD_RANGE' });
  return { start, end, from: dayKey(a), to: dayKey(b) };
}
