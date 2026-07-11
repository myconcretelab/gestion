ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_worker_id" TEXT;

CREATE INDEX "planning_relay_periods_sms_worker_idx" ON "planning_relay_periods"("sms_worker_id");

ALTER TABLE "planning_relay_periods"
  ADD CONSTRAINT "planning_relay_periods_sms_worker_id_fkey"
  FOREIGN KEY ("sms_worker_id") REFERENCES "planning_relay_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
