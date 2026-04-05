ALTER TABLE "gites" ADD COLUMN "electricity_price_per_kwh" REAL NOT NULL DEFAULT 0;

ALTER TABLE "reservations" ADD COLUMN "stay_group_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN "energy_consumption_kwh" REAL NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN "energy_cost_eur" REAL NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN "energy_price_per_kwh" REAL;
ALTER TABLE "reservations" ADD COLUMN "energy_tracking" TEXT NOT NULL DEFAULT '[]';

UPDATE "reservations"
SET "stay_group_id" = "id"
WHERE "stay_group_id" IS NULL;

CREATE INDEX "reservations_stay_group_id_idx" ON "reservations"("stay_group_id");
