-- Track the cleaning check independently for the arrival and departure operations.
ALTER TABLE "reservations" ADD COLUMN "arrival_cleaning_checked_at" DATETIME;
ALTER TABLE "reservations" ADD COLUMN "departure_cleaning_checked_at" DATETIME;

-- Existing checks represented a gite ready for the guest, so preserve them as arrival checks.
UPDATE "reservations"
SET "arrival_cleaning_checked_at" = "cleaning_checked_at"
WHERE "cleaning_checked_at" IS NOT NULL;

ALTER TABLE "reservations" DROP COLUMN "cleaning_checked_at";
