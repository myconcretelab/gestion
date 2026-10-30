ALTER TABLE "reservation_recorded_payments" ADD COLUMN "ota_details" TEXT;
CREATE TABLE "ota_transactions" (
 "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "channel" TEXT NOT NULL,
 "external_key" TEXT NOT NULL, "import_id" TEXT NOT NULL, "source_hash" TEXT NOT NULL,
 "file_name" TEXT NOT NULL, "type" TEXT NOT NULL, "payout_reference" TEXT NOT NULL,
 "confirmation_code" TEXT NOT NULL, "paid_on" TIMESTAMP(3) NOT NULL, "arrival_by" TIMESTAMP(3),
 "gross_cents" INTEGER NOT NULL, "fee_cents" INTEGER NOT NULL, "net_cents" INTEGER NOT NULL,
 "raw_json" TEXT NOT NULL, "reservation_id" TEXT, "recorded_payment_id" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("recorded_payment_id") REFERENCES "reservation_recorded_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ota_transactions_org_channel_reference_key" ON "ota_transactions"("organization_id", "channel", "external_key");
CREATE UNIQUE INDEX "ota_transactions_recorded_payment_id_key" ON "ota_transactions"("recorded_payment_id");
CREATE INDEX "ota_transactions_org_import_idx" ON "ota_transactions"("organization_id", "import_id");
