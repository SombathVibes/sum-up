// ☁️ OneDrive: each group can copy the 📊 Excel files it makes into a folder
// of a connected OneDrive (personal or work; Microsoft Graph).
//
// Connecting: the Mini App asks for a sign-in link (authLink), the person signs
// in to Microsoft and approves, Microsoft sends them back to the Worker's
// /onedrive/callback (finishConnect), which saves the account's refresh token.
// Needs the Worker secrets MS_CLIENT_ID and MS_CLIENT_SECRET (an app registered
// in Azure with the redirect URI <worker>/onedrive/callback).

import { db, secret } from 'sdk';
import { eq } from 'sdk/db';
import { groupOnedrive, onedriveAccounts, settings } from '../schema.js';
import { now } from './dates.js';
import { getSetting, setSetting } from './store.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access Files.ReadWrite User.Read';
const STATE_TTL = 15 * 60; // a sign-in link works 15 minutes

export const onedriveReady = () => !!(secret('MS_CLIENT_ID') && secret('MS_CLIENT_SECRET'));
const redirectUri = (origin) => `${origin}/onedrive/callback`;

/** A Microsoft sign-in link for this user (and the group they started from). */
export async function authLink(origin, userId, groupId) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await setSetting(`od_state:${nonce}`, JSON.stringify({ userId, groupId, at: now() }));
  const q = new URLSearchParams({
    client_id: secret('MS_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: redirectUri(origin),
    response_mode: 'query',
    scope: SCOPE,
    state: nonce,
    prompt: 'select_account',
  });
  return `${AUTH}/authorize?${q}`;
}

async function tokenRequest(origin, params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: secret('MS_CLIENT_ID'), client_secret: secret('MS_CLIENT_SECRET'), scope: SCOPE, ...(origin ? { redirect_uri: redirectUri(origin) } : {}), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.error_description?.split('\n')[0] || body.error || `HTTP ${res.status}`);
  return body;
}

/**
 * Microsoft's redirect back: code + state → the account saved (or updated if
 * already connected). Returns { ok, text, groupId } for the page shown.
 */
export async function finishConnect(origin, params) {
  const nonce = String(params.get('state') ?? '');
  const raw = /^[0-9a-f]{36}$/.test(nonce) ? await getSetting(`od_state:${nonce}`) : null;
  if (raw) await db.delete(settings).where(eq(settings.key, `od_state:${nonce}`)).run();
  let state = null;
  try {
    state = JSON.parse(raw ?? 'null');
  } catch {
    // broken: treated as expired
  }
  if (!state || now() - state.at > STATE_TTL) return { ok: false, text: 'តំណនេះផុតកំណត់ ឬប្រើរួចហើយ — ចុច «🔗 ភ្ជាប់ OneDrive» ម្ដងទៀតនៅ Mini App។' };
  if (params.get('error')) return { ok: false, text: `Microsoft: ${String(params.get('error_description') ?? params.get('error')).split('\n')[0].slice(0, 200)}` };
  const code = params.get('code');
  if (!code) return { ok: false, text: 'Microsoft មិនបានផ្ញើលេខកូដមកវិញទេ។' };

  const tok = await tokenRequest(origin, { grant_type: 'authorization_code', code });
  const meRes = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.id) throw new Error(`Graph /me: HTTP ${meRes.status}`);
  const values = {
    ownerId: state.userId,
    msId: String(me.id),
    email: String(me.userPrincipalName || me.mail || ''),
    name: String(me.displayName || ''),
    refreshToken: tok.refresh_token ?? '',
    accessToken: tok.access_token,
    expiresAt: now() + Number(tok.expires_in ?? 3600) - 120,
    error: '',
  };
  // The same Microsoft account connected again (by the same person): refreshed in place.
  const existing = (await db.select().from(onedriveAccounts).where(eq(onedriveAccounts.msId, values.msId)).all())
    .find((a) => a.ownerId === state.userId);
  let id;
  if (existing) {
    await db.update(onedriveAccounts).set(values).where(eq(onedriveAccounts.id, existing.id)).run();
    id = existing.id;
  } else {
    const [row] = await db.insert(onedriveAccounts).values({ ...values, createdAt: now() }).returning();
    id = row.id;
  }
  // The group it was started from now uses it (switched on, default folder kept).
  if (state.groupId) {
    const cur = await groupOnedriveConfig(state.groupId);
    await saveGroupOnedrive(state.groupId, { enabled: true, accountId: id, folder: cur.folder }, state.userId);
  }
  return { ok: true, text: `✅ បានភ្ជាប់ OneDrive ${values.email || values.name} — ត្រឡប់ទៅ Telegram វិញបាន។`, accountId: id, userId: state.userId, email: values.email };
}

/** An access token for this account, refreshed when old (the new refresh token is kept). */
async function accessToken(account) {
  if (account.accessToken && account.expiresAt > now()) return account.accessToken;
  if (!account.refreshToken) throw new Error('Not connected — connect OneDrive again.');
  let tok;
  try {
    tok = await tokenRequest(null, { grant_type: 'refresh_token', refresh_token: account.refreshToken });
  } catch (e) {
    await db.update(onedriveAccounts).set({ error: `🔑 ${e.message}`.slice(0, 300) }).where(eq(onedriveAccounts.id, account.id)).run();
    throw new Error(`sign-in expired — connect OneDrive again (${e.message})`);
  }
  const values = { accessToken: tok.access_token, refreshToken: tok.refresh_token || account.refreshToken, expiresAt: now() + Number(tok.expires_in ?? 3600) - 120 };
  await db.update(onedriveAccounts).set(values).where(eq(onedriveAccounts.id, account.id)).run();
  return values.accessToken;
}

export const getAccount = async (id) => (await db.select().from(onedriveAccounts).where(eq(onedriveAccounts.id, Number(id))).get()) ?? null;

/** Accounts as the Mini App sees them (no tokens). Super admins: all; others: their own. */
export async function listAccounts(user, isSuperAdmin) {
  const rows = await db.select().from(onedriveAccounts).all();
  return rows.filter((a) => isSuperAdmin || a.ownerId === user.id)
    .map((a) => ({ id: a.id, email: a.email, name: a.name, error: a.error, mine: a.ownerId === user.id }));
}

/** Removes an account (and switches off the groups that used it). */
export async function deleteAccount(id) {
  await db.delete(onedriveAccounts).where(eq(onedriveAccounts.id, Number(id))).run();
  await db.update(groupOnedrive).set({ enabled: false, accountId: 0 }).where(eq(groupOnedrive.accountId, Number(id))).run();
}

// OneDrive refuses these in names.
const clean = (s) => String(s ?? '').replace(/["*:<>?\\|]/g, ' ').replace(/\s+/g, ' ').trim();
/** 'A / B /C' → 'A/B/C', each part cleaned; '' when nothing is left. */
export const cleanFolder = (folder) => String(folder ?? '').split('/').map(clean).filter((p) => p && p !== '.' && p !== '..').join('/').slice(0, 200);
export const defaultFolder = (groupName) => cleanFolder(`SumUp/${groupName || 'Group'}`);

const DEFAULTS = { enabled: false, accountId: 0, folder: '', setBy: 0 };
export async function groupOnedriveConfig(groupId) {
  const row = await db.select().from(groupOnedrive).where(eq(groupOnedrive.groupId, groupId)).get();
  return { ...DEFAULTS, ...(row ?? {}), groupId };
}

export async function saveGroupOnedrive(groupId, { enabled, accountId, folder }, setBy) {
  const values = { enabled: !!enabled, accountId: Number(accountId) || 0, folder: cleanFolder(folder), setBy };
  await db.insert(groupOnedrive).values({ groupId, ...values })
    .onConflictDoUpdate({ target: groupOnedrive.groupId, set: values }).run();
}

/** Puts bytes at <folder>/<name> in the account's OneDrive (replacing a file of that name). Returns the web link. */
export async function uploadFile(account, folder, name, bytes) {
  const token = await accessToken(account);
  const path = [...cleanFolder(folder).split('/').filter(Boolean), clean(name)].map(encodeURIComponent).join('/');
  const res = await fetch(`${GRAPH}/me/drive/root:/${path}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: bytes,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OneDrive: ${body.error?.message ?? `HTTP ${res.status}`}`.slice(0, 200));
  if (account.error) await db.update(onedriveAccounts).set({ error: '' }).where(eq(onedriveAccounts.id, account.id)).run();
  return body.webUrl ?? '';
}

/**
 * After a group's 📊 Excel is made: a copy to its OneDrive, if it has one on.
 * `sig` skips a file already uploaded unchanged; `getBytes()` gives the file.
 * Returns '' (nothing to do), '☁️ …' (done) or throws.
 */
export async function copyExcelForGroup(groupId, { sig, name, getBytes }) {
  if (!groupId) return '';
  const cfg = await groupOnedriveConfig(groupId);
  if (!cfg.enabled || !cfg.accountId) return '';
  const account = await getAccount(cfg.accountId);
  if (!account) return '';
  const folder = cfg.folder || 'SumUp';
  const key = `od:${groupId}:${account.id}:${folder}/${name}`;
  if ((await getSetting(key)) === sig) return `☁️ OneDrive: ${folder}/${name}`;
  await uploadFile(account, folder, name, await getBytes());
  await setSetting(key, sig);
  return `☁️ OneDrive ✅ ${folder}/${name}`;
}
