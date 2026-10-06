ALTER TABLE "app_users" ADD COLUMN "hourly_rate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "app_users" ADD COLUMN "cleaning_check_rate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "app_users" ADD COLUMN "full_cleaning_rate" REAL NOT NULL DEFAULT 0;

UPDATE "app_users"
SET "hourly_rate" = COALESCE((
  SELECT worker."hourly_rate"
  FROM "planning_relay_workers" worker
  WHERE worker."id" = "app_users"."intervenant_id"
), 0);

CREATE TABLE "user_interventions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT,
  "user_name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurred_on" TEXT NOT NULL,
  "gite_id" TEXT,
  "gite_name" TEXT,
  "reservation_id" TEXT,
  "source_key" TEXT,
  "amount_snapshot" REAL NOT NULL,
  "paid_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "user_interventions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "user_interventions_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "user_interventions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_interventions_source_key_key" ON "user_interventions"("source_key");
CREATE INDEX "user_interventions_user_paid_idx" ON "user_interventions"("user_id", "paid_at");
CREATE INDEX "user_interventions_date_kind_idx" ON "user_interventions"("occurred_on", "kind");
