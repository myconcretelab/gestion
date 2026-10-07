-- Multi-tenant expand/backfill migration for PostgreSQL.
-- Safe to resume: all structures use IF NOT EXISTS and all backfills use
-- deterministic keys with ON CONFLICT.

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY,
  "login_id" TEXT NOT NULL UNIQUE,
  "email" TEXT UNIQUE,
  "password_hash" TEXT,
  "password_salt" TEXT,
  "password_updated_at" TIMESTAMP(3),
  "auth_version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "memberships" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'custom',
  "status" TEXT NOT NULL DEFAULT 'active',
  "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "invited_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "organization_id")
);
CREATE INDEX IF NOT EXISTS "memberships_organization_status_idx" ON "memberships"("organization_id", "status");

CREATE TABLE IF NOT EXISTS "organization_settings" (
  "organization_id" TEXT PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "profile_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "locale" TEXT NOT NULL DEFAULT 'fr-FR',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  "branding_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "documents_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "modules_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "setup_completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "organizations" ("id", "slug", "name", "status")
VALUES ('org_historical_broceliande', 'historique', 'Les Gîtes de Brocéliande', 'active')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "organization_settings" (
  "organization_id", "profile_json", "locale", "currency", "timezone", "branding_json", "documents_json", "modules_json", "setup_completed"
)
SELECT
  'org_historical_broceliande', "organization_json"::jsonb,
  COALESCE("organization_json"::jsonb->>'locale', 'fr-FR'),
  COALESCE("organization_json"::jsonb->>'currency', 'EUR'),
  COALESCE("organization_json"::jsonb->>'timezone', 'Europe/Paris'),
  "organization_json"::jsonb, "organization_json"::jsonb, "modules_json"::jsonb, "setup_completed"
FROM "installation_config" WHERE "id" = 'default'
ON CONFLICT ("organization_id") DO NOTHING;

INSERT INTO "organization_settings" ("organization_id")
VALUES ('org_historical_broceliande')
ON CONFLICT ("organization_id") DO NOTHING;

INSERT INTO "users" (
  "id", "login_id", "email", "password_hash", "password_salt", "password_updated_at", "auth_version", "createdAt", "updatedAt"
)
SELECT
  "id", COALESCE(NULLIF(btrim("login_id"), ''), 'legacy:' || "id"),
  CASE WHEN "login_id" IS NOT NULL THEN NULLIF(lower(btrim("email")), '') ELSE NULL END,
  "password_hash", "password_salt", "password_updated_at", "auth_version", "createdAt", "updatedAt"
FROM "app_users"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "memberships" (
  "id", "user_id", "organization_id", "role", "status", "permissions", "accepted_at", "createdAt", "updatedAt"
)
SELECT
  'membership_' || "id", "id", 'org_historical_broceliande',
  CASE WHEN "is_owner" THEN 'owner' ELSE "status" END,
  CASE WHEN "is_active" THEN 'active' ELSE 'disabled' END,
  jsonb_build_object('roles', "roles", 'pageAccess', "page_access", 'canWrite', "can_write", 'canViewAmounts', "can_view_amounts"),
  "createdAt", "createdAt", "updatedAt"
FROM "app_users"
ON CONFLICT ("user_id", "organization_id") DO NOTHING;

ALTER TABLE "installation_config" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "content_template_versions" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gites" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_photos" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "wordpress_webhook_jobs" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gestionnaires" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "app_users" SET "user_id" = "id" WHERE "user_id" IS NULL;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "document_shares" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_recurring_rules" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_entries" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "urssaf_declarations" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "guest_night_declarations" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "ical_sources" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "contrats" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "contrat_counters" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "factures" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "facture_counters" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "reservation_placeholders" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_periods" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_workers" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "intervenant_hour_entries" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "user_interventions" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "intervenant_expenses" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_assignments" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_season_rates" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "booking_requests" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_monthly_energy_readings" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';

DROP INDEX IF EXISTS "content_template_versions_key_version_key";
DROP INDEX IF EXISTS "gites_public_slug_key";
DROP INDEX IF EXISTS "gestionnaires_prenom_nom_key";
DROP INDEX IF EXISTS "expense_categories_scope_name_key";
DROP INDEX IF EXISTS "urssaf_declarations_period_manager_key";
DROP INDEX IF EXISTS "guest_night_declarations_period_gite_key";
DROP INDEX IF EXISTS "ical_sources_gite_url_key";
DROP INDEX IF EXISTS "contrats_numero_contrat_key";
DROP INDEX IF EXISTS "contrat_counters_giteId_year_key";
DROP INDEX IF EXISTS "factures_numero_facture_key";
DROP INDEX IF EXISTS "facture_counters_giteId_year_key";
DROP INDEX IF EXISTS "reservation_placeholders_abbreviation_key";
DROP INDEX IF EXISTS "user_interventions_source_key_key";
DROP INDEX IF EXISTS "planning_relay_assignments_period_date_gite_key";
DROP INDEX IF EXISTS "gite_monthly_energy_readings_period_device_key";

CREATE UNIQUE INDEX IF NOT EXISTS "content_template_versions_org_key_version_key" ON "content_template_versions"("organization_id", "template_key", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "gites_org_public_slug_key" ON "gites"("organization_id", "public_slug");
CREATE UNIQUE INDEX IF NOT EXISTS "gestionnaires_organization_id_prenom_nom_key" ON "gestionnaires"("organization_id", "prenom", "nom");
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_org_user_key" ON "app_users"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "app_users_org_active_name_idx" ON "app_users"("organization_id", "is_active", "display_name");
CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_org_scope_name_key" ON "expense_categories"("organization_id", "scope", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "urssaf_declarations_org_period_manager_key" ON "urssaf_declarations"("organization_id", "year", "month", "gestionnaire_id");
CREATE UNIQUE INDEX IF NOT EXISTS "guest_night_declarations_org_period_gite_key" ON "guest_night_declarations"("organization_id", "year", "month", "gite_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ical_sources_org_gite_url_key" ON "ical_sources"("organization_id", "gite_id", "url");
CREATE UNIQUE INDEX IF NOT EXISTS "contrats_org_numero_key" ON "contrats"("organization_id", "numero_contrat");
CREATE UNIQUE INDEX IF NOT EXISTS "contrat_counters_organization_id_giteId_year_key" ON "contrat_counters"("organization_id", "giteId", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "factures_org_numero_key" ON "factures"("organization_id", "numero_facture");
CREATE UNIQUE INDEX IF NOT EXISTS "facture_counters_organization_id_giteId_year_key" ON "facture_counters"("organization_id", "giteId", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_placeholders_org_abbreviation_key" ON "reservation_placeholders"("organization_id", "abbreviation");
CREATE UNIQUE INDEX IF NOT EXISTS "user_interventions_org_source_key" ON "user_interventions"("organization_id", "source_key");
CREATE UNIQUE INDEX IF NOT EXISTS "planning_relay_assignments_org_period_date_gite_key" ON "planning_relay_assignments"("organization_id", "period_id", "date", "gite_id");
CREATE UNIQUE INDEX IF NOT EXISTS "gite_monthly_energy_readings_org_period_device_key" ON "gite_monthly_energy_readings"("organization_id", "gite_id", "year", "month", "device_id");
