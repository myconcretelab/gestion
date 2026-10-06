ALTER TABLE "app_users" ADD COLUMN "login_id" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_salt" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_updated_at" DATETIME;
ALTER TABLE "app_users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "app_users_login_id_key" ON "app_users"("login_id");

CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions"("expires_at");

CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "last_used_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_active_idx" ON "api_tokens"("revoked_at", "expires_at");

CREATE TABLE "document_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_hash" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_access_at" DATETIME,
    "created_by_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "document_shares_token_hash_key" ON "document_shares"("token_hash");
CREATE INDEX "document_shares_document_idx" ON "document_shares"("document_type", "document_id", "revoked_at");
CREATE INDEX "document_shares_expires_idx" ON "document_shares"("expires_at");
