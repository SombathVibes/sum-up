// ☁️ Google Drive: each group can copy the 📊 Excel files it makes into a
// folder of a connected Google Drive.
//
// Connecting: the Mini App asks for a sign-in link (authLink), the person signs
// in to Google and allows it, Google sends them back to the Worker's
// /gdrive/callback (finishConnect), which saves the account's refresh token.
// Needs the Worker secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (an OAuth
// client in Google Cloud with the redirect URI <worker>/gdrive/callback).
//
// The scope is drive.file: the bot sees only the folders and files it made
// itself, nothing else in the Drive.

import { db, secret } from 'sdk';
import { eq } from 'sdk/db';
import { gdriveAccounts, groupGdrive, settings } from '../schema.js';
import { now } from './dates.js';
import { getSetting, setSetting } from './store.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATE_TTL = 15 * 60; // a sign-in link works 15 minutes

export const gdriveReady = () => !!(secret('GOOGLE_CLIENT_ID') && secret('GOOGLE_CLIENT_SECRET'));
const redirectUri = (origin) => `${origin}/gdrive/callback`;

/** A Google sign-in link for this user (and the group they started from). */
export async function authLink(origin, userId, groupId) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await setSetting(`gd_state:${nonce}`, JSON.stringify({ userId, groupId, at: now() }));
  const q = new URLSearchParams({
    client_id: secret('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // a refresh token, so uploads work later without signing in
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state: nonce,
  });
  return `${AUTH}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: secret('GOOGLE_CLIENT_ID'), client_secret: secret('GOOGLE_CLIENT_SECRET'), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `HTTP ${res.status}`);
  return body;
}

/** The email and name in Google's id_token (straight from Google's token endpoint over TLS). */
function idClaims(idToken) {
  try {
    const part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}

/**
 * Google's redirect back: code + state → the account saved (or updated if
 * already connected). Returns { ok, text, … } for the page shown.
 */
export async function finishConnect(origin, params) {
  const nonce = String(params.get('state') ?? '');
  const raw = /^[0-9a-f]{36}$/.test(nonce) ? await getSetting(`gd_state:${nonce}`) : null;
  if (raw) await db.delete(settings).where(eq(settings.key, `gd_state:${nonce}`)).run();
  let state = null;
  try {
    state = JSON.parse(raw ?? 'null');
  } catch {
    // broken: treated as expired
  }
  if (!state || now() - state.at > STATE_TTL) return { ok: false, text: 'តំណនេះផុតកំណត់ ឬប្រើរួចហើយ — ចុច «🔗 ភ្ជាប់ Google Drive» ម្ដងទៀតនៅ Mini App។' };
  if (params.get('error')) return { ok: false, text: `Google: ${String(params.get('error')).slice(0, 200)}` };
  const code = params.get('code');
  if (!code) return { ok: false, text: 'Google មិនបានផ្ញើលេខកូដមកវិញទេ។' };
  if (!String(params.get('scope') ?? '').includes('drive.file')) {
    return { ok: false, text: 'សូមធីក «See, edit, create… Google Drive files» ពេលអនុញ្ញាត — ចុច «🔗 ភ្ជាប់ Google Drive» ម្ដងទៀត។' };
  }

  const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(origin) });
  const me = idClaims(tok.id_token);
  if (!me.sub) throw new Error('Google did not say which account this is.');
  const values = {
    ownerId: state.userId,
    googleId: String(me.sub),
    email: String(me.email ?? ''),
    name: String(me.name ?? ''),
    accessToken: tok.access_token,
    expiresAt: now() + Number(tok.expires_in ?? 3600) - 120,
    error: '',
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
  };
  // The same Google account connected again (by the same person): refreshed in place.
  const existing = (await db.select().from(gdriveAccounts).where(eq(gdriveAccounts.googleId, values.googleId)).all())
    .find((a) => a.ownerId === state.userId);
  if (!existing && !values.refreshToken) throw new Error('Google gave no refresh token — remove the bot’s access at myaccount.google.com/permissions and connect again.');
  let id;
  if (existing) {
    await db.update(gdriveAccounts).set(values).where(eq(gdriveAccounts.id, existing.id)).run();
    id = existing.id;
  } else {
    const [row] = await db.insert(gdriveAccounts).values({ ...values, createdAt: now() }).returning();
    id = row.id;
  }
  // The group it was started from now uses it (switched on, its folder kept).
  if (state.groupId) {
    const cur = await groupGdriveConfig(state.groupId);
    await saveGroupGdrive(state.groupId, { enabled: true, accountId: id, folder: cur.folder }, state.userId);
  }
  return { ok: true, text: `✅ បានភ្ជាប់ Google Drive ${values.email || values.name} — ត្រឡប់ទៅ Telegram វិញបាន។`, accountId: id, userId: state.userId, email: values.email };
}

/** An access token for this account, refreshed when old. */
async function accessToken(account) {
  if (account.accessToken && account.expiresAt > now()) return account.accessToken;
  if (!account.refreshToken) throw new Error('Not connected — connect Google Drive again.');
  let tok;
  try {
    tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
  } catch (e) {
    await db.update(gdriveAccounts).set({ error: `🔑 ${e.message}`.slice(0, 300) }).where(eq(gdriveAccounts.id, account.id)).run();
    throw new Error(`sign-in expired — connect Google Drive again (${e.message})`);
  }
  const values = { accessToken: tok.access_token, expiresAt: now() + Number(tok.expires_in ?? 3600) - 120, ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}) };
  await db.update(gdriveAccounts).set(values).where(eq(gdriveAccounts.id, account.id)).run();
  return values.accessToken;
}

export const getAccount = async (id) => (await db.select().from(gdriveAccounts).where(eq(gdriveAccounts.id, Number(id))).get()) ?? null;

/** Accounts as the Mini App sees them (no tokens). Super admins: all; others: their own. */
export async function listAccounts(user, isSuperAdmin) {
  const rows = await db.select().from(gdriveAccounts).all();
  return rows.filter((a) => isSuperAdmin || a.ownerId === user.id)
    .map((a) => ({ id: a.id, email: a.email, name: a.name, error: a.error, mine: a.ownerId === user.id }));
}

/** Removes an account (Google's access revoked too) and switches off the groups that used it. */
export async function deleteAccount(account) {
  if (account.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(account.refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
  await db.delete(gdriveAccounts).where(eq(gdriveAccounts.id, account.id)).run();
  await db.update(groupGdrive).set({ enabled: false, accountId: 0 }).where(eq(groupGdrive.accountId, account.id)).run();
}

const clean = (s) => String(s ?? '').replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim();
/** 'A / B /C' → 'A/B/C', each part cleaned; '' when nothing is left. */
export const cleanFolder = (folder) => String(folder ?? '').split('/').map(clean).filter((p) => p && p !== '.' && p !== '..').join('/').slice(0, 200);
export const defaultFolder = (groupName) => cleanFolder(`SumUp/${groupName || 'Group'}`);

const DEFAULTS = { enabled: false, accountId: 0, folder: '', setBy: 0 };
export async function groupGdriveConfig(groupId) {
  const row = await db.select().from(groupGdrive).where(eq(groupGdrive.groupId, groupId)).get();
  return { ...DEFAULTS, ...(row ?? {}), groupId };
}

export async function saveGroupGdrive(groupId, { enabled, accountId, folder }, setBy) {
  const values = { enabled: !!enabled, accountId: Number(accountId) || 0, folder: cleanFolder(folder), setBy };
  await db.insert(groupGdrive).values({ groupId, ...values })
    .onConflictDoUpdate({ target: groupGdrive.groupId, set: values }).run();
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function drive(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google Drive: ${body.error?.message ?? `HTTP ${res.status}`}`.slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return body;
}

/** The first file (this bot made) named `name` in `parent`, with `mime` if given. */
async function findChild(token, parent, name, mime) {
  const query = `name = ${q(name)} and ${q(parent)} in parents and trashed = false${mime ? ` and mimeType = ${q(mime)}` : ''}`;
  const r = await drive(token, `${DRIVE}/files?${new URLSearchParams({ q: query, fields: 'files(id,webViewLink)', pageSize: '1', spaces: 'drive' })}`);
  return r.files?.[0] ?? null;
}

/** The folder at path (made as needed), its id remembered per account. */
async function folderId(token, account, path) {
  const key = `gd_folder:${account.id}:${path}`;
  const saved = await getSetting(key);
  if (saved) return saved;
  let parent = 'root';
  for (const part of path.split('/').filter(Boolean)) {
    const found = await findChild(token, parent, part, FOLDER);
    parent = found?.id ?? (await drive(token, `${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: part, mimeType: FOLDER, parents: [parent] }),
    })).id;
  }
  await setSetting(key, parent);
  return parent;
}

/** Puts bytes at <folder>/<name> in the account's Drive (replacing the file of that name). Returns its link. */
export async function uploadFile(account, folder, name, bytes) {
  const token = await accessToken(account);
  const path = cleanFolder(folder);
  const fileName = clean(name);
  for (let attempt = 0; ; attempt++) {
    try {
      const parent = path ? await folderId(token, account, path) : 'root';
      const existing = await findChild(token, parent, fileName);
      let file;
      if (existing) {
        file = await drive(token, `${UPLOAD}/files/${existing.id}?uploadType=media&fields=id,webViewLink`, { method: 'PATCH', headers: { 'Content-Type': XLSX }, body: bytes });
      } else {
        const boundary = `sumup${crypto.randomUUID()}`;
        const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${XLSX}\r\n\r\n`);
        const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
        const body = new Uint8Array(head.length + bytes.length + tail.length);
        body.set(head, 0);
        body.set(bytes, head.length);
        body.set(tail, head.length + bytes.length);
        file = await drive(token, `${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      }
      if (account.error) await db.update(gdriveAccounts).set({ error: '' }).where(eq(gdriveAccounts.id, account.id)).run();
      return file.webViewLink ?? '';
    } catch (e) {
      // A remembered folder deleted in Drive: forget it and make it again, once.
      if (attempt === 0 && path && (e.status === 404 || e.status === 403)) {
        await db.delete(settings).where(eq(settings.key, `gd_folder:${account.id}:${path}`)).run();
        continue;
      }
      throw e;
    }
  }
}

/**
 * After a group's 📊 Excel is made: a copy to its Google Drive, if it has one
 * on. `sig` skips a file already uploaded unchanged; `getBytes()` gives the
 * file. Returns '' (nothing to do), '☁️ …' (done) or throws.
 */
export async function copyExcelForGroup(groupId, { sig, name, getBytes }) {
  if (!groupId) return '';
  const cfg = await groupGdriveConfig(groupId);
  if (!cfg.enabled || !cfg.accountId) return '';
  const account = await getAccount(cfg.accountId);
  if (!account) return '';
  const folder = cfg.folder || 'SumUp';
  const key = `gd:${groupId}:${account.id}:${folder}/${name}`;
  if ((await getSetting(key)) === sig) return `☁️ Google Drive: ${folder}/${name}`;
  await uploadFile(account, folder, name, await getBytes());
  await setSetting(key, sig);
  return `☁️ Google Drive ✅ ${folder}/${name}`;
}
