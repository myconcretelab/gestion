-- Outgoing sandbox transport is separate from immutable local invoices.
CREATE UNIQUE INDEX "superpdp_connections_id_entity_org_key" ON "superpdp_connections" ("id", "fiscal_entity_id", "organization_id");
CREATE UNIQUE INDEX "factures_id_entity_org_key" ON "factures" ("id", "fiscal_entity_id", "organization_id");
CREATE TABLE "electronic_invoice_transmissions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "invoice_id" TEXT NOT NULL,
  "fiscal_entity_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox' CHECK ("environment" = 'sandbox'),
  "remote_company_id" TEXT NOT NULL,
  "remote_invoice_id" TEXT,
  "external_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'queued_prepare',
  "preparation_id" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  "payload_sha256" TEXT NOT NULL,
  "snapshot_sha256" TEXT NOT NULL,
  "original_pdf_sha256" TEXT NOT NULL,
  "artifact_path" TEXT,
  "artifact_sha256" TEXT,
  "validation_json" TEXT,
  "validation_valid" INTEGER NOT NULL DEFAULT false,
  "operation_id" TEXT,
  "operation_expires_at" DATETIME,
  "post_started_at" DATETIME,
  "events_cursor" TEXT,
  "reconcile_cursor" TEXT,
  "next_sync_at" DATETIME,
  "last_synced_at" DATETIME,
  "last_error_code" TEXT,
  "requested_by" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "electronic_transmissions_invoice_org_fkey" FOREIGN KEY ("invoice_id", "fiscal_entity_id", "organization_id") REFERENCES "factures" ("id", "fiscal_entity_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "electronic_transmissions_connection_org_fkey" FOREIGN KEY ("connection_id", "fiscal_entity_id", "organization_id") REFERENCES "superpdp_connections" ("id", "fiscal_entity_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "electronic_invoice_transmissions_external_id_key" ON "electronic_invoice_transmissions" ("external_id");
CREATE UNIQUE INDEX "electronic_transmissions_id_org_key" ON "electronic_invoice_transmissions" ("id", "organization_id");
CREATE UNIQUE INDEX "electronic_transmissions_invoice_env_key" ON "electronic_invoice_transmissions" ("organization_id", "invoice_id", "environment");
CREATE UNIQUE INDEX "electronic_transmissions_remote_key" ON "electronic_invoice_transmissions" ("organization_id", "connection_id", "remote_invoice_id");
CREATE INDEX "electronic_transmissions_sync_idx" ON "electronic_invoice_transmissions" ("status", "next_sync_at");
CREATE TABLE "electronic_invoice_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "transmission_id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "status_code" TEXT NOT NULL,
  "occurred_at" DATETIME NOT NULL,
  "payload_json" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "electronic_events_transmission_org_fkey" FOREIGN KEY ("transmission_id", "organization_id") REFERENCES "electronic_invoice_transmissions" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "electronic_events_dedup_key" ON "electronic_invoice_events" ("organization_id", "transmission_id", "event_key");
CREATE INDEX "electronic_events_history_idx" ON "electronic_invoice_events" ("organization_id", "transmission_id", "occurred_at");
