CREATE TABLE IF NOT EXISTS "plans" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "billing_periods" JSONB NOT NULL DEFAULT '[]'::jsonb, "status" TEXT NOT NULL DEFAULT 'active', "public_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "plan_entitlements" (
  "id" TEXT PRIMARY KEY, "plan_id" TEXT NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "feature_key" TEXT NOT NULL, "value_boolean" BOOLEAN, "limit_value" INTEGER, "limit_type" TEXT NOT NULL DEFAULT 'hard',
  UNIQUE ("plan_id","feature_key")
);
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "plan_id" TEXT NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "status" TEXT NOT NULL DEFAULT 'active',
  "trial_start" TIMESTAMP(3), "trial_end" TIMESTAMP(3), "current_period_start" TIMESTAMP(3), "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false, "cancelled_at" TIMESTAMP(3), "grace_period_end" TIMESTAMP(3),
  "provider" TEXT, "provider_customer_id" TEXT, "provider_subscription_id" TEXT, "sync_version" INTEGER NOT NULL DEFAULT 0,
  "last_synced_at" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions"("status");
CREATE TABLE IF NOT EXISTS "organization_entitlement_overrides" (
  "id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "feature_key" TEXT NOT NULL, "value_boolean" BOOLEAN, "limit_value" INTEGER, "reason" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3), "author_user_id" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "entitlement_overrides_lookup_idx" ON "organization_entitlement_overrides"("organization_id","feature_key","expires_at");
CREATE TABLE IF NOT EXISTS "usage_counters" (
  "id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "metric_key" TEXT NOT NULL, "period_key" TEXT NOT NULL, "value" INTEGER NOT NULL DEFAULT 0, "source" TEXT NOT NULL DEFAULT 'computed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organization_id","metric_key","period_key")
);
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subscription_id" TEXT REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE, "provider" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL, "type" TEXT NOT NULL, "payload_reference" TEXT, "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'received', "result" TEXT, "error_message" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processed_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider","provider_event_id"), UNIQUE ("provider","idempotency_key")
);
CREATE INDEX IF NOT EXISTS "billing_events_org_received_idx" ON "billing_events"("organization_id","received_at");
CREATE TABLE IF NOT EXISTS "platform_administrators" (
  "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'billing_admin', "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "plans" ("id","code","name","description","billing_periods","status","public_metadata")
VALUES ('plan_legacy_unlimited','legacy_unlimited','Historique illimité','Préserve sans facturation les capacités historiques.','[]'::jsonb,'archived','{"commercial":false}'::jsonb)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "plan_entitlements" ("id","plan_id","feature_key","value_boolean","limit_value","limit_type") VALUES
('legacy_ent_1', 'plan_legacy_unlimited', 'module.reservations', true, NULL, 'hard'),
('legacy_ent_2', 'plan_legacy_unlimited', 'module.contracts', true, NULL, 'hard'),
('legacy_ent_3', 'plan_legacy_unlimited', 'module.invoices', true, NULL, 'hard'),
('legacy_ent_4', 'plan_legacy_unlimited', 'module.finances', true, NULL, 'hard'),
('legacy_ent_5', 'plan_legacy_unlimited', 'module.personal_expenses', true, NULL, 'hard'),
('legacy_ent_6', 'plan_legacy_unlimited', 'module.worker_planning', true, NULL, 'hard'),
('legacy_ent_7', 'plan_legacy_unlimited', 'module.web_publication', true, NULL, 'hard'),
('legacy_ent_8', 'plan_legacy_unlimited', 'module.ical', true, NULL, 'hard'),
('legacy_ent_9', 'plan_legacy_unlimited', 'module.pump_airbnb', true, NULL, 'hard'),
('legacy_ent_10', 'plan_legacy_unlimited', 'module.smart_life', true, NULL, 'hard'),
('legacy_ent_11', 'plan_legacy_unlimited', 'module.sms', true, NULL, 'hard'),
('legacy_ent_12', 'plan_legacy_unlimited', 'module.telegram', true, NULL, 'hard'),
('legacy_ent_13', 'plan_legacy_unlimited', 'module.daily_email', true, NULL, 'hard')
ON CONFLICT ("plan_id","feature_key") DO NOTHING;
INSERT INTO "subscriptions" ("id","organization_id","plan_id","status","provider","sync_version")
SELECT 'subscription_legacy_' || "id", "id", 'plan_legacy_unlimited', 'active', NULL, 0
FROM "organizations" WHERE "id" = 'org_historical_broceliande'
ON CONFLICT ("organization_id") DO NOTHING;
