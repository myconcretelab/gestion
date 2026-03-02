-- Add structured options on reservations and links from contracts/invoices to reservations
ALTER TABLE "reservations" ADD COLUMN "options" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "contrats" ADD COLUMN "reservation_id" TEXT;
ALTER TABLE "factures" ADD COLUMN "reservation_id" TEXT;

CREATE INDEX "contrats_reservation_id_idx" ON "contrats"("reservation_id");
CREATE INDEX "factures_reservation_id_idx" ON "factures"("reservation_id");
