ALTER TABLE "gites" ADD COLUMN "electricity_price_per_kwh" DECIMAL(10,4) NOT NULL DEFAULT 0;

ALTER TABLE "reservations" ADD COLUMN "stay_group_id" TEXT;
ALTER TABLE "reservations" ADD COLUMN "energy_consumption_kwh" DECIMAL(12,4) NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN "energy_cost_eur" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN "energy_price_per_kwh" DECIMAL(10,4);
ALTER TABLE "reservations" ADD COLUMN "energy_tracking" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "reservations"
SET "stay_group_id" = "id"
WHERE "stay_group_id" IS NULL;

CREATE INDEX "reservations_stay_group_id_idx" ON "reservations"("stay_group_id");
