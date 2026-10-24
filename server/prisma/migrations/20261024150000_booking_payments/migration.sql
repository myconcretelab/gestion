CREATE TABLE "booking_payments" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
 "booking_request_id" TEXT NOT NULL,
 "purpose" TEXT NOT NULL,
 "amount_cents" INTEGER NOT NULL,
 "total_cents" INTEGER NOT NULL,
 "currency" TEXT NOT NULL DEFAULT 'eur',
 "status" TEXT NOT NULL DEFAULT 'pending',
 "access_token_hash" TEXT NOT NULL,
 "stripe_session_id" TEXT,
 "stripe_payment_intent" TEXT,
 "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
 "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0,
 "expires_at" DATETIME NOT NULL,
 "paid_at" DATETIME,
 "review_reason" TEXT,
 "notification_sent_at" DATETIME,
 "notification_lease_at" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "booking_payments_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_payments_booking_request_id_key" ON "booking_payments"("booking_request_id");
CREATE UNIQUE INDEX "booking_payments_stripe_session_id_key" ON "booking_payments"("stripe_session_id");
CREATE UNIQUE INDEX "booking_payments_stripe_payment_intent_key" ON "booking_payments"("stripe_payment_intent");
CREATE INDEX "booking_payments_organization_id_status_createdAt_idx" ON "booking_payments"("organization_id", "status", "createdAt");
