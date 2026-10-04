CREATE TABLE "app_user_status_presets" (
  "status" TEXT NOT NULL PRIMARY KEY,
  "page_access" TEXT NOT NULL DEFAULT '[]',
  "can_write" BOOLEAN NOT NULL DEFAULT false,
  "can_view_amounts" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "app_user_status_presets" ("status", "page_access", "can_write", "can_view_amounts", "updatedAt") VALUES
  ('owner', '["today","reservations","booking_requests","calendar","planning_relay","contracts","invoices","gites","professional_expenses","personal_expenses","statistics","rates","settings"]', true, true, CURRENT_TIMESTAMP),
  ('worker', '["today","calendar","planning_relay"]', true, false, CURRENT_TIMESTAMP),
  ('custom', '[]', false, false, CURRENT_TIMESTAMP);
