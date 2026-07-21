ALTER TABLE "planning_relay_periods" ADD COLUMN "stay_nights" INTEGER;
ALTER TABLE "planning_relay_periods" ADD COLUMN "sms_configs" TEXT NOT NULL DEFAULT '[]';
