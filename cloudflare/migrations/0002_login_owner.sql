-- Who added a lottery login (lib/roles.js loginRole): managers see only their own.
ALTER TABLE "lottery_logins" ADD COLUMN "owner_id" INTEGER NOT NULL DEFAULT 0;
