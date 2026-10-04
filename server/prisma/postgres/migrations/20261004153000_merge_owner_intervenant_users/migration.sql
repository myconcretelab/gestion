WITH matches AS (
  SELECT duplicate_user."id" AS duplicate_user_id, owner."id" AS owner_user_id, worker."id" AS intervenant_id
  FROM "app_users" AS duplicate_user
  JOIN "planning_relay_workers" AS worker ON worker."id" = duplicate_user."intervenant_id"
  JOIN "app_users" AS owner
    ON owner."is_owner" = true
   AND owner."intervenant_id" IS NULL
   AND (lower(owner."display_name") = lower(worker."nom") OR lower(owner."display_name") LIKE lower(worker."nom") || ' %')
  WHERE duplicate_user."status" = 'worker'
)
UPDATE "app_users" AS owner
SET "intervenant_id" = matches.intervenant_id
FROM matches
WHERE owner."id" = matches.owner_user_id;

DELETE FROM "app_users" AS duplicate_user
WHERE duplicate_user."status" = 'worker'
  AND duplicate_user."intervenant_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "app_users" AS owner
    WHERE owner."is_owner" = true AND owner."intervenant_id" = duplicate_user."intervenant_id"
  );
