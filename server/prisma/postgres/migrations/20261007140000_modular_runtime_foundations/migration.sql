CREATE TABLE IF NOT EXISTS "organization_runtime_settings" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "value_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_secret" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organization_id", "key")
);

CREATE TABLE IF NOT EXISTS "organization_jobs" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "lock_owner" TEXT,
  "last_error" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  UNIQUE ("organization_id", "idempotency_key")
);
CREATE INDEX IF NOT EXISTS "organization_jobs_org_status_run_idx" ON "organization_jobs"("organization_id", "status", "run_at");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" TEXT,
  "request_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs"("organization_id", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_org_resource_idx" ON "audit_logs"("organization_id", "resource_type", "resource_id");

CREATE TABLE IF NOT EXISTS "document_assets" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "storage_key" TEXT NOT NULL,
  "legacy_path" TEXT,
  "content_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  UNIQUE ("organization_id", "storage_key")
);
CREATE INDEX IF NOT EXISTS "document_assets_org_status_idx" ON "document_assets"("organization_id", "status");
