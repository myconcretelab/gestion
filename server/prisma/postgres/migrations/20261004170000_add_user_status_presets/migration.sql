CREATE TABLE "app_user_status_presets" (
  "status" TEXT NOT NULL,
  "page_access" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "can_write" BOOLEAN NOT NULL DEFAULT false,
  "can_view_amounts" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_user_status_presets_pkey" PRIMARY KEY ("status")
);

INSERT INTO "app_user_status_presets" ("status", "page_access", "can_write", "can_view_amounts", "updatedAt") VALUES
  ('owner', '["today","reservations","booking_requests","calendar","planning_relay","contracts","invoices","gites","professional_expenses","personal_expenses","statistics","rates","settings"]'::jsonb, true, true, CURRENT_TIMESTAMP),
  ('worker', '["today","calendar","planning_relay"]'::jsonb, true, false, CURRENT_TIMESTAMP),
  ('custom', '[]'::jsonb, false, false, CURRENT_TIMESTAMP);
