ALTER TABLE "app_users" ADD COLUMN "full_cleaning_rates" JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE "app_users" AS user_rate
SET "full_cleaning_rates" = COALESCE((
  SELECT jsonb_object_agg(gite."id", user_rate."full_cleaning_rate")
  FROM "gites" AS gite WHERE gite."organization_id" = user_rate."organization_id"
), '{}'::jsonb)
WHERE user_rate."full_cleaning_rate" > 0;
ALTER TABLE "user_interventions" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
