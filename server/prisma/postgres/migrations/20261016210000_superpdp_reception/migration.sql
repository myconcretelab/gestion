-- Incoming invoices do not create or modify ledger entries.
CREATE UNIQUE INDEX "intervenant_expenses_id_org_key" ON "intervenant_expenses" ("id", "organization_id");
CREATE TABLE "superpdp_inbox_syncs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "fiscal_entity_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "remote_company_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox' CHECK ("environment" = 'sandbox'),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "invoices_cursor" TEXT,
  "events_cursor" TEXT,
  "operation_id" TEXT,
  "operation_expires_at" TIMESTAMP(3),
  "next_sync_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "requested_by" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "superpdp_inbox_sync_connection_org_fkey" FOREIGN KEY ("connection_id", "fiscal_entity_id", "organization_id") REFERENCES "superpdp_connections" ("id", "fiscal_entity_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "superpdp_inbox_sync_id_org_key" ON "superpdp_inbox_syncs" ("id", "organization_id");
CREATE UNIQUE INDEX "superpdp_inbox_sync_id_company_org_key" ON "superpdp_inbox_syncs" ("id", "remote_company_id", "organization_id");
CREATE UNIQUE INDEX "superpdp_inbox_sync_company_key" ON "superpdp_inbox_syncs" ("organization_id", "connection_id", "remote_company_id", "environment");
CREATE INDEX "superpdp_inbox_sync_due_idx" ON "superpdp_inbox_syncs" ("enabled", "next_sync_at");
CREATE TABLE "incoming_invoices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "sync_id" TEXT NOT NULL,
  "remote_company_id" TEXT NOT NULL,
  "remote_invoice_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox' CHECK ("environment" = 'sandbox'),
  "remote_created_at" TIMESTAMP(3) NOT NULL,
  "invoice_number" TEXT,
  "supplier_name" TEXT,
  "issue_date" TEXT,
  "type_code" INTEGER,
  "currency" TEXT,
  "total_without_vat" TEXT,
  "total_vat" TEXT,
  "total_with_vat" TEXT,
  "structured_json" TEXT,
  "structured_sha256" TEXT,
  "details_next_check_at" TIMESTAMP(3),
  "original_path" TEXT NOT NULL,
  "original_sha256" TEXT NOT NULL,
  "original_format" TEXT NOT NULL,
  "expense_id" TEXT,
  "expense_snapshot_json" TEXT,
  "matched_at" TIMESTAMP(3),
  "matched_by" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incoming_invoices_sync_org_fkey" FOREIGN KEY ("sync_id", "remote_company_id", "organization_id") REFERENCES "superpdp_inbox_syncs" ("id", "remote_company_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "incoming_invoices_expense_org_fkey" FOREIGN KEY ("expense_id", "organization_id") REFERENCES "intervenant_expenses" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "incoming_invoices_id_org_key" ON "incoming_invoices" ("id", "organization_id");
CREATE UNIQUE INDEX "incoming_invoices_remote_key" ON "incoming_invoices" ("organization_id", "remote_company_id", "remote_invoice_id", "environment");
CREATE UNIQUE INDEX "incoming_invoices_expense_key" ON "incoming_invoices" ("organization_id", "expense_id");
CREATE INDEX "incoming_invoices_list_idx" ON "incoming_invoices" ("organization_id", "sync_id", "remote_created_at");
CREATE TABLE "superpdp_inbox_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "sync_id" TEXT NOT NULL,
  "remote_event_id" TEXT NOT NULL,
  "remote_invoice_id" TEXT NOT NULL,
  "status_code" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "payload_json" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "superpdp_inbox_events_sync_org_fkey" FOREIGN KEY ("sync_id", "organization_id") REFERENCES "superpdp_inbox_syncs" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "superpdp_inbox_events_remote_key" ON "superpdp_inbox_events" ("organization_id", "sync_id", "remote_event_id");
CREATE INDEX "superpdp_inbox_events_invoice_idx" ON "superpdp_inbox_events" ("organization_id", "sync_id", "remote_invoice_id", "occurred_at");
