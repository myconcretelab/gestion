-- Move cleaning check from gites to reservations so each stay tracks its own state.
ALTER TABLE "gites" DROP COLUMN "cleaning_checked_at";
ALTER TABLE "reservations" ADD COLUMN "cleaning_checked_at" DATETIME;
