ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_recipient" TEXT;
ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_send_time" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_last_sent_for_date" TEXT;
ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_last_attempt_for_date" TEXT;

CREATE INDEX "planning_relay_periods_sms_schedule_idx"
ON "planning_relay_periods"("sms_enabled", "sms_send_time");
