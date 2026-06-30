ALTER TABLE "planning_relay_periods" ADD COLUMN "public_code_hash" TEXT;

CREATE UNIQUE INDEX "planning_relay_periods_public_code_hash_key"
ON "planning_relay_periods"("public_code_hash");

CREATE TABLE "security_throttles" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" DATETIME NOT NULL,
    "blocked_until" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "security_throttles_scope_updated_at_idx"
ON "security_throttles"("scope", "updatedAt");
