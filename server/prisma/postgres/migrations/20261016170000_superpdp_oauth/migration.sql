-- Sandbox/production records are distinct; no existing invoice is touched.
CREATE TABLE "superpdp_connections" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "fiscal_entity_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox' CHECK ("environment" IN ('sandbox', 'production')),
  "status" TEXT NOT NULL DEFAULT 'configured',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "local_siren" TEXT NOT NULL,
  "client_id" TEXT,
  "encrypted_client_secret" TEXT,
  "expected_number" TEXT,
  "encrypted_tokens" TEXT,
  "access_expires_at" TIMESTAMP(3),
  "remote_company_id" TEXT,
  "remote_company_number" TEXT,
  "remote_company_name" TEXT,
  "verification_status" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "operation_id" TEXT,
  "operation_expires_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "superpdp_connections_entity_org_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "superpdp_connections_id_org_key" ON "superpdp_connections" ("id", "organization_id");
CREATE UNIQUE INDEX "superpdp_connections_org_entity_env_key" ON "superpdp_connections" ("organization_id", "fiscal_entity_id", "environment");
CREATE UNIQUE INDEX "superpdp_connections_org_remote_env_key" ON "superpdp_connections" ("organization_id", "environment", "remote_company_id");
CREATE TABLE "superpdp_oauth_states" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "connection_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_hash" TEXT NOT NULL,
  "encrypted_verifier" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "superpdp_oauth_states_connection_org_fkey" FOREIGN KEY ("connection_id", "organization_id") REFERENCES "superpdp_connections" ("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "superpdp_oauth_states_org_connection_idx" ON "superpdp_oauth_states" ("organization_id", "connection_id");
CREATE INDEX "superpdp_oauth_states_expires_idx" ON "superpdp_oauth_states" ("expires_at");
