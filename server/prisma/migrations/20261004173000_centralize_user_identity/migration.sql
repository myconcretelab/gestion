ALTER TABLE "app_users" ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "app_users" ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '';

UPDATE "app_users"
SET "first_name" = COALESCE(
      (SELECT "prenom" FROM "gestionnaires" WHERE "gestionnaires"."id" = "app_users"."gestionnaire_id"),
      "display_name"
    ),
    "last_name" = COALESCE(
      (SELECT "nom" FROM "gestionnaires" WHERE "gestionnaires"."id" = "app_users"."gestionnaire_id"),
      ''
    );
