ALTER TABLE "reservations" ADD COLUMN "booking_source" TEXT;
ALTER TABLE "reservations" ADD COLUMN "payments_managed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "reservation_recorded_payments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservation_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" > 0),
  "method" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'payment',
  "paid_on" DATETIME,
  "note" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "voided_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_DATETIME,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  CONSTRAINT "reservation_recorded_payments_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "reservation_recorded_payments_org_reservation_idx" ON "reservation_recorded_payments" ("organization_id", "reservation_id");
