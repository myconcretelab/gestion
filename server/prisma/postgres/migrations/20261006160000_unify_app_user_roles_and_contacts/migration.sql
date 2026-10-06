ALTER TABLE "app_users" ADD COLUMN "roles" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "app_users" ADD COLUMN "telephone" TEXT;
ALTER TABLE "app_users" ADD COLUMN "email" TEXT;
ALTER TABLE "app_users" ADD COLUMN "adresse" TEXT;
ALTER TABLE "app_users" ADD COLUMN "telegram_chat_id" TEXT;

UPDATE "app_users"
SET "roles" = CASE
  WHEN ("is_owner" = TRUE OR "status" = 'owner') AND "intervenant_id" IS NOT NULL THEN '["owner","worker"]'
  WHEN "is_owner" = TRUE OR "status" = 'owner' THEN '["owner"]'
  WHEN "intervenant_id" IS NOT NULL OR "status" = 'worker' THEN '["worker"]'
  ELSE '[]'
END;

UPDATE "app_users" app_user
SET "telephone" = worker."telephone",
    "email" = worker."email",
    "adresse" = worker."adresse",
    "telegram_chat_id" = worker."message_channel_addresses"::jsonb ->> 'telegram'
FROM "planning_relay_workers" worker
WHERE worker."id" = app_user."intervenant_id";

UPDATE "planning_relay_workers"
SET "message_channel_addresses" = "message_channel_addresses" - 'telegram';
