-- CreateTable
CREATE TABLE "reservation_payment_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "reservation_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "deposit_cents" INTEGER NOT NULL,
    "offline_received_cents" INTEGER NOT NULL DEFAULT 0,
    "terms_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reservation_payment_links_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_booking_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "booking_request_id" TEXT,
    "reservation_id" TEXT,
    "payment_link_id" TEXT,
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
    CONSTRAINT "booking_payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "booking_payments_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "reservation_payment_links" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "booking_payments_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "booking_requests" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_booking_payments" ("access_token_hash", "amount_cents", "booking_request_id", "createdAt", "currency", "expires_at", "id", "notification_lease_at", "notification_sent_at", "organization_id", "paid_amount_cents", "paid_at", "purpose", "refunded_amount_cents", "review_reason", "status", "stripe_payment_intent", "stripe_session_id", "total_cents", "updatedAt") SELECT "access_token_hash", "amount_cents", "booking_request_id", "createdAt", "currency", "expires_at", "id", "notification_lease_at", "notification_sent_at", "organization_id", "paid_amount_cents", "paid_at", "purpose", "refunded_amount_cents", "review_reason", "status", "stripe_payment_intent", "stripe_session_id", "total_cents", "updatedAt" FROM "booking_payments";
DROP TABLE "booking_payments";
ALTER TABLE "new_booking_payments" RENAME TO "booking_payments";
CREATE UNIQUE INDEX "booking_payments_booking_request_id_key" ON "booking_payments"("booking_request_id");
CREATE UNIQUE INDEX "booking_payments_stripe_session_id_key" ON "booking_payments"("stripe_session_id");
CREATE UNIQUE INDEX "booking_payments_stripe_payment_intent_key" ON "booking_payments"("stripe_payment_intent");
CREATE INDEX "booking_payments_organization_id_status_createdAt_idx" ON "booking_payments"("organization_id", "status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "reservation_payment_links_code_key" ON "reservation_payment_links"("code");

-- CreateIndex
CREATE INDEX "reservation_payment_links_organization_id_reservation_id_status_idx" ON "reservation_payment_links"("organization_id", "reservation_id", "status");

