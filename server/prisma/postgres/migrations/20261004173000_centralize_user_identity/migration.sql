ALTER TABLE "app_users" ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "app_users" ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '';

UPDATE "app_users" AS app_user
SET "first_name" = gestionnaire."prenom",
    "last_name" = gestionnaire."nom"
FROM "gestionnaires" AS gestionnaire
WHERE app_user."gestionnaire_id" = gestionnaire."id";

UPDATE "app_users"
SET "first_name" = "display_name"
WHERE "first_name" = '';
