ALTER TABLE "app_users" ADD COLUMN "hourly_rate" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "app_users" ADD COLUMN "cleaning_check_rate" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "app_users" ADD COLUMN "full_cleaning_rate" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "app_users" app_user
SET "hourly_rate" = COALESCE(worker."hourly_rate", 0)
FROM "planning_relay_workers" worker
WHERE worker."id" = app_user."intervenant_id";

CREATE TABLE "user_interventions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "user_name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurred_on" TEXT NOT NULL,
  "gite_id" TEXT,
  "gite_name" TEXT,
  "reservation_id" TEXT,
  "source_key" TEXT,
  "amount_snapshot" DECIMAL(10,2) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_interventions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_interventions_source_key_key" ON "user_interventions"("source_key");
CREATE INDEX "user_interventions_user_paid_idx" ON "user_interventions"("user_id", "paid_at");
CREATE INDEX "user_interventions_date_kind_idx" ON "user_interventions"("occurred_on", "kind");
ALTER TABLE "user_interventions" ADD CONSTRAINT "user_interventions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_interventions" ADD CONSTRAINT "user_interventions_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_interventions" ADD CONSTRAINT "user_interventions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
