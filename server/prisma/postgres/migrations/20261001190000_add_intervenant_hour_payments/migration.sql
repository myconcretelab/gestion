ALTER TABLE "planning_relay_workers" ADD COLUMN "hourly_rate" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "intervenant_hour_entries" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "intervenant_hour_entries" ADD COLUMN "hourly_rate_snapshot" DECIMAL(10,2);

CREATE INDEX "intervenant_hours_worker_paid_idx" ON "intervenant_hour_entries" ("intervenant_id", "paid_at");
