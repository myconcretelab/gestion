ALTER TABLE "app_users" ADD COLUMN "intervenant_id" TEXT REFERENCES "planning_relay_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "app_users" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE "app_users" ADD COLUMN "page_access" TEXT NOT NULL DEFAULT '[]';

UPDATE "app_users"
SET "status" = CASE WHEN "is_owner" THEN 'owner' ELSE 'custom' END,
    "page_access" = CASE WHEN "is_owner" THEN '["today","reservations","booking_requests","calendar","planning_relay","contracts","invoices","gites","professional_expenses","personal_expenses","statistics","rates","settings"]' ELSE '[]' END;

INSERT INTO "app_users" (
  "id", "display_name", "intervenant_id", "status", "page_access",
  "can_write", "can_view_amounts", "is_owner", "is_active", "createdAt", "updatedAt"
)
SELECT
  'user_' || lower(hex(randomblob(12))), "nom", "id", 'worker',
  '["today","calendar","planning_relay"]', true, false, false, "is_active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "planning_relay_workers"
WHERE NOT EXISTS (SELECT 1 FROM "app_users" WHERE "app_users"."intervenant_id" = "planning_relay_workers"."id");

CREATE UNIQUE INDEX "app_users_intervenant_id_key" ON "app_users"("intervenant_id");

ALTER TABLE "reservations" ADD COLUMN "arrival_cleaning_checked_by_user_id" TEXT REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD COLUMN "departure_cleaning_checked_by_user_id" TEXT REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "reservations_arrival_cleaning_user_idx" ON "reservations"("arrival_cleaning_checked_by_user_id");
CREATE INDEX "reservations_departure_cleaning_user_idx" ON "reservations"("departure_cleaning_checked_by_user_id");
