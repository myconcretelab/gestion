ALTER TABLE "app_users" ADD COLUMN "login_id" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_salt" TEXT;
ALTER TABLE "app_users" ADD COLUMN "password_updated_at" TIMESTAMP(3);
ALTER TABLE "app_users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "app_users_login_id_key" ON "app_users"("login_id");

CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions"("expires_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_active_idx" ON "api_tokens"("revoked_at", "expires_at");

CREATE TABLE "document_shares" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_access_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_shares_token_hash_key" ON "document_shares"("token_hash");
CREATE INDEX "document_shares_document_idx" ON "document_shares"("document_type", "document_id", "revoked_at");
CREATE INDEX "document_shares_expires_idx" ON "document_shares"("expires_at");
