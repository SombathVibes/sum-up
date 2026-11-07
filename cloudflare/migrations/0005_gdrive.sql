-- ☁️ OneDrive → Google Drive (the OneDrive tables were never used).
DROP TABLE IF EXISTS "onedrive_accounts";
DROP TABLE IF EXISTS "group_onedrive";
CREATE TABLE IF NOT EXISTS "gdrive_accounts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "owner_id" INTEGER NOT NULL DEFAULT 0, "google_id" TEXT NOT NULL DEFAULT '', "email" TEXT NOT NULL DEFAULT '', "name" TEXT NOT NULL DEFAULT '', "refresh_token" TEXT NOT NULL DEFAULT '', "access_token" TEXT NOT NULL DEFAULT '', "expires_at" INTEGER NOT NULL DEFAULT 0, "error" TEXT NOT NULL DEFAULT '', "created_at" INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS "group_gdrive" ("group_id" INTEGER PRIMARY KEY, "enabled" INTEGER NOT NULL DEFAULT 0, "account_id" INTEGER NOT NULL DEFAULT 0, "folder" TEXT NOT NULL DEFAULT '', "set_by" INTEGER NOT NULL DEFAULT 0);
