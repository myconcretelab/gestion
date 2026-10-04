CREATE TEMP TABLE "owner_intervenant_merge" (
  "duplicate_user_id" TEXT PRIMARY KEY,
  "owner_user_id" TEXT NOT NULL,
  "intervenant_id" TEXT NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO "owner_intervenant_merge" ("duplicate_user_id", "owner_user_id", "intervenant_id")
SELECT duplicate_user."id", owner."id", worker."id"
FROM "app_users" AS duplicate_user
JOIN "planning_relay_workers" AS worker ON worker."id" = duplicate_user."intervenant_id"
JOIN "app_users" AS owner
  ON owner."is_owner" = true
 AND owner."intervenant_id" IS NULL
 AND (lower(owner."display_name") = lower(worker."nom") OR lower(owner."display_name") LIKE lower(worker."nom") || ' %')
WHERE duplicate_user."status" = 'worker';

UPDATE "app_users" AS duplicate_user
SET "intervenant_id" = NULL
FROM "owner_intervenant_merge" AS merge_row
WHERE duplicate_user."id" = merge_row."duplicate_user_id";

UPDATE "app_users" AS owner
SET "intervenant_id" = merge_row."intervenant_id"
FROM "owner_intervenant_merge" AS merge_row
WHERE owner."id" = merge_row."owner_user_id";

DELETE FROM "app_users" AS duplicate_user
USING "owner_intervenant_merge" AS merge_row
WHERE duplicate_user."id" = merge_row."duplicate_user_id";
