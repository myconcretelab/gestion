-- A sandbox registration number is not a SIREN. Preserve a missing local SIREN as NULL.
-- Rebuild only the parent table, keeping all ciphertexts, locks, references and indexes.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE "new_superpdp_connections" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "fiscal_entity_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox' CHECK ("environment" IN ('sandbox', 'production')),
  "status" TEXT NOT NULL DEFAULT 'configured',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "local_siren" TEXT,
  "client_id" TEXT,
  "encrypted_client_secret" TEXT,
  "expected_number" TEXT,
  "encrypted_tokens" TEXT,
  "access_expires_at" DATETIME,
  "remote_company_id" TEXT,
  "remote_company_number" TEXT,
  "remote_company_name" TEXT,
  "verification_status" TEXT,
  "last_checked_at" DATETIME,
  "last_error_code" TEXT,
  "operation_id" TEXT,
  "operation_expires_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "superpdp_connections_siren_or_sandbox_check" CHECK ("local_siren" IS NOT NULL OR "environment" = 'sandbox'),
  CONSTRAINT "superpdp_connections_entity_org_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_superpdp_connections" (
  "id", "organization_id", "fiscal_entity_id", "environment", "status", "generation", "local_siren", "client_id",
  "encrypted_client_secret", "expected_number", "encrypted_tokens", "access_expires_at", "remote_company_id",
  "remote_company_number", "remote_company_name", "verification_status", "last_checked_at", "last_error_code",
  "operation_id", "operation_expires_at", "createdAt", "updatedAt"
) SELECT
  "id", "organization_id", "fiscal_entity_id", "environment", "status", "generation", "local_siren", "client_id",
  "encrypted_client_secret", "expected_number", "encrypted_tokens", "access_expires_at", "remote_company_id",
  "remote_company_number", "remote_company_name", "verification_status", "last_checked_at", "last_error_code",
  "operation_id", "operation_expires_at", "createdAt", "updatedAt"
FROM "superpdp_connections";
DROP TABLE "superpdp_connections";
ALTER TABLE "new_superpdp_connections" RENAME TO "superpdp_connections";
CREATE UNIQUE INDEX "superpdp_connections_id_entity_org_key" ON "superpdp_connections" ("id", "fiscal_entity_id", "organization_id");
CREATE UNIQUE INDEX "superpdp_connections_id_org_key" ON "superpdp_connections" ("id", "organization_id");
CREATE UNIQUE INDEX "superpdp_connections_org_entity_env_key" ON "superpdp_connections" ("organization_id", "fiscal_entity_id", "environment");
CREATE UNIQUE INDEX "superpdp_connections_org_remote_env_key" ON "superpdp_connections" ("organization_id", "environment", "remote_company_id");
COMMIT;
PRAGMA foreign_keys=ON;
