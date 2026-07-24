ALTER TABLE "planning_relay_workers"
ADD COLUMN "message_channel_addresses" JSONB NOT NULL DEFAULT '{}'::jsonb;
