UPDATE "app_users" AS owner
SET "intervenant_id" = (
  SELECT worker."id"
  FROM "planning_relay_workers" AS worker
  WHERE owner."intervenant_id" IS NULL
    AND (lower(owner."display_name") = lower(worker."nom") OR lower(owner."display_name") LIKE lower(worker."nom") || ' %')
    AND EXISTS (SELECT 1 FROM "app_users" AS duplicate_user WHERE duplicate_user."intervenant_id" = worker."id" AND duplicate_user."status" = 'worker')
  LIMIT 1
)
WHERE owner."is_owner" = true
  AND owner."intervenant_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "planning_relay_workers" AS worker
    WHERE lower(owner."display_name") = lower(worker."nom") OR lower(owner."display_name") LIKE lower(worker."nom") || ' %'
  );

DELETE FROM "app_users" AS duplicate_user
WHERE duplicate_user."status" = 'worker'
  AND duplicate_user."intervenant_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "app_users" AS owner
    WHERE owner."is_owner" = true AND owner."intervenant_id" = duplicate_user."intervenant_id"
  );
