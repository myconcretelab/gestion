CREATE TABLE "plans" (
  "id" TEXT NOT NULL PRIMARY KEY, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "billing_periods" TEXT NOT NULL DEFAULT '[]', "status" TEXT NOT NULL DEFAULT 'active', "public_metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
CREATE TABLE "plan_entitlements" (
  "id" TEXT NOT NULL PRIMARY KEY, "plan_id" TEXT NOT NULL, "feature_key" TEXT NOT NULL, "value_boolean" BOOLEAN,
  "limit_value" INTEGER, "limit_type" TEXT NOT NULL DEFAULT 'hard',
  CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "plan_entitlements_plan_feature_key" ON "plan_entitlements"("plan_id", "feature_key");
CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "plan_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active',
  "trial_start" DATETIME, "trial_end" DATETIME, "current_period_start" DATETIME, "current_period_end" DATETIME,
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false, "cancelled_at" DATETIME, "grace_period_end" DATETIME,
  "provider" TEXT, "provider_customer_id" TEXT, "provider_subscription_id" TEXT, "sync_version" INTEGER NOT NULL DEFAULT 0,
  "last_synced_at" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "subscriptions_organization_key" ON "subscriptions"("organization_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE TABLE "organization_entitlement_overrides" (
  "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "feature_key" TEXT NOT NULL, "value_boolean" BOOLEAN,
  "limit_value" INTEGER, "reason" TEXT NOT NULL, "expires_at" DATETIME, "author_user_id" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "organization_entitlement_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "entitlement_overrides_lookup_idx" ON "organization_entitlement_overrides"("organization_id", "feature_key", "expires_at");
CREATE TABLE "usage_counters" (
  "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "metric_key" TEXT NOT NULL, "period_key" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0, "source" TEXT NOT NULL DEFAULT 'computed',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "usage_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "usage_counters_org_metric_period_key" ON "usage_counters"("organization_id", "metric_key", "period_key");
CREATE TABLE "billing_events" (
  "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "subscription_id" TEXT, "provider" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL, "type" TEXT NOT NULL, "payload_reference" TEXT, "payload_json" TEXT NOT NULL DEFAULT '{}',
  "idempotency_key" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'received', "result" TEXT, "error_message" TEXT,
  "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "processed_at" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "billing_events_provider_event_key" ON "billing_events"("provider", "provider_event_id");
CREATE UNIQUE INDEX "billing_events_provider_idempotency_key" ON "billing_events"("provider", "idempotency_key");
CREATE INDEX "billing_events_org_received_idx" ON "billing_events"("organization_id", "received_at");
CREATE TABLE "platform_administrators" (
  "user_id" TEXT NOT NULL PRIMARY KEY, "role" TEXT NOT NULL DEFAULT 'billing_admin', "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "platform_administrators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "plans" ("id","code","name","description","billing_periods","status","public_metadata","updatedAt")
VALUES ('plan_legacy_unlimited','legacy_unlimited','Historique illimité','Préserve sans facturation les capacités historiques.','[]','archived','{"commercial":false}',CURRENT_TIMESTAMP);
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
('legacy_ent_13', 'plan_legacy_unlimited', 'module.daily_email', true, NULL, 'hard');
INSERT INTO "subscriptions" ("id","organization_id","plan_id","status","provider","sync_version","updatedAt")
SELECT 'subscription_legacy_' || "id", "id", 'plan_legacy_unlimited', 'active', NULL, 0, CURRENT_TIMESTAMP
FROM "organizations" WHERE "id" = 'org_historical_broceliande';
