CREATE TABLE "gite_monthly_energy_readings" (
  "id" TEXT NOT NULL,
  "gite_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "opening_total_kwh" DECIMAL(12,4),
  "opening_recorded_at" TIMESTAMP(3),
  "closing_total_kwh" DECIMAL(12,4),
  "closing_recorded_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gite_monthly_energy_readings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gite_monthly_energy_readings"
  ADD CONSTRAINT "gite_monthly_energy_readings_gite_id_fkey"
  FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "gite_monthly_energy_readings_period_device_key"
  ON "gite_monthly_energy_readings"("gite_id", "year", "month", "device_id");

CREATE INDEX "gite_monthly_energy_readings_period_idx"
  ON "gite_monthly_energy_readings"("year", "month");

CREATE INDEX "gite_monthly_energy_readings_gite_period_idx"
  ON "gite_monthly_energy_readings"("gite_id", "year", "month");
