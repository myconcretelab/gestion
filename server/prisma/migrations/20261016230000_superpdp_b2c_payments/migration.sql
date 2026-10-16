ALTER TABLE "electronic_invoice_transmissions" ADD COLUMN "reporting_profile_json" TEXT;
ALTER TABLE "electronic_invoice_transmissions" ADD COLUMN "payments_revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "electronic_invoice_payments" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
 "transmission_id" TEXT NOT NULL,
 "reference" TEXT NOT NULL,
 "payment_date" TEXT NOT NULL,
 "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" > 0),
 "allocations_json" TEXT NOT NULL,
 "payload_json" TEXT NOT NULL,
 "payload_sha256" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'recorded',
 "post_started_at" DATETIME,
 "remote_event_id" TEXT,
 "operation_id" TEXT,
 "operation_expires_at" DATETIME,
 "last_error_code" TEXT,
 "requested_by" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "electronic_payments_transmission_org_fkey" FOREIGN KEY ("transmission_id", "organization_id") REFERENCES "electronic_invoice_transmissions" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "electronic_payments_reference_key" ON "electronic_invoice_payments" ("organization_id", "transmission_id", "reference");
CREATE UNIQUE INDEX "electronic_payments_remote_key" ON "electronic_invoice_payments" ("organization_id", "transmission_id", "remote_event_id");
