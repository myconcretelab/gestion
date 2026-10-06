ALTER TABLE "app_users" ADD COLUMN "roles" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "app_users" ADD COLUMN "telephone" TEXT;
ALTER TABLE "app_users" ADD COLUMN "email" TEXT;
ALTER TABLE "app_users" ADD COLUMN "adresse" TEXT;
ALTER TABLE "app_users" ADD COLUMN "telegram_chat_id" TEXT;

UPDATE "app_users"
SET "roles" = CASE
  WHEN ("is_owner" = 1 OR "status" = 'owner') AND "intervenant_id" IS NOT NULL THEN '["owner","worker"]'
  WHEN "is_owner" = 1 OR "status" = 'owner' THEN '["owner"]'
  WHEN "intervenant_id" IS NOT NULL OR "status" = 'worker' THEN '["worker"]'
  ELSE '[]'
END;

UPDATE "app_users"
SET "telephone" = (SELECT worker."telephone" FROM "planning_relay_workers" worker WHERE worker."id" = "app_users"."intervenant_id"),
    "email" = (SELECT worker."email" FROM "planning_relay_workers" worker WHERE worker."id" = "app_users"."intervenant_id"),
    "adresse" = (SELECT worker."adresse" FROM "planning_relay_workers" worker WHERE worker."id" = "app_users"."intervenant_id"),
    "telegram_chat_id" = (
      SELECT CASE
        WHEN json_valid(worker."message_channel_addresses") THEN json_extract(worker."message_channel_addresses", '$.telegram')
        ELSE NULL
      END
      FROM "planning_relay_workers" worker
      WHERE worker."id" = "app_users"."intervenant_id"
    )
WHERE "intervenant_id" IS NOT NULL;

UPDATE "planning_relay_workers"
SET "message_channel_addresses" = CASE
  WHEN json_valid("message_channel_addresses") THEN json_remove("message_channel_addresses", '$.telegram')
  ELSE '{}'
END;
