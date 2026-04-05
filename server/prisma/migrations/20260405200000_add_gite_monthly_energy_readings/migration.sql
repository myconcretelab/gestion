CREATE TABLE "gite_monthly_energy_readings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gite_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "opening_total_kwh" REAL,
  "opening_recorded_at" DATETIME,
  "closing_total_kwh" REAL,
  "closing_recorded_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "gite_monthly_energy_readings_gite_id_fkey"
    FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "gite_monthly_energy_readings_period_device_key"
  ON "gite_monthly_energy_readings"("gite_id", "year", "month", "device_id");

CREATE INDEX "gite_monthly_energy_readings_period_idx"
  ON "gite_monthly_energy_readings"("year", "month");

CREATE INDEX "gite_monthly_energy_readings_gite_period_idx"
  ON "gite_monthly_energy_readings"("gite_id", "year", "month");
