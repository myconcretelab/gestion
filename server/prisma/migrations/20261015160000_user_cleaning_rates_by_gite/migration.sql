ALTER TABLE "app_users" ADD COLUMN "full_cleaning_rates" TEXT NOT NULL DEFAULT '{}';
UPDATE "app_users"
SET "full_cleaning_rates" = COALESCE((
  SELECT json_group_object("gites"."id", "app_users"."full_cleaning_rate")
  FROM "gites" WHERE "gites"."organization_id" = "app_users"."organization_id"
), '{}')
WHERE "full_cleaning_rate" > 0;
ALTER TABLE "user_interventions" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
