CREATE TABLE "organization_runtime_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "value_json" TEXT NOT NULL DEFAULT '{}',
  "is_secret" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "organization_runtime_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_runtime_settings_org_key" ON "organization_runtime_settings"("organization_id", "key");

CREATE TABLE "organization_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" DATETIME,
  "lock_owner" TEXT,
  "last_error" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" DATETIME,
  CONSTRAINT "organization_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_jobs_org_idempotency_key" ON "organization_jobs"("organization_id", "idempotency_key");
CREATE INDEX "organization_jobs_org_status_run_idx" ON "organization_jobs"("organization_id", "status", "run_at");

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT,
  "request_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs"("organization_id", "createdAt");
CREATE INDEX "audit_logs_org_resource_idx" ON "audit_logs"("organization_id", "resource_type", "resource_id");

CREATE TABLE "document_assets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "legacy_path" TEXT,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" DATETIME,
  CONSTRAINT "document_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "document_assets_org_storage_key" ON "document_assets"("organization_id", "storage_key");
CREATE INDEX "document_assets_org_status_idx" ON "document_assets"("organization_id", "status");
