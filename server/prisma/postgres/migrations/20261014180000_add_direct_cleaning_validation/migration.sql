ALTER TABLE "app_users" ADD COLUMN "direct_cleaning_validation" BOOLEAN NOT NULL DEFAULT false;

UPDATE "app_users"
SET "direct_cleaning_validation" = true
WHERE "is_owner" = true;
