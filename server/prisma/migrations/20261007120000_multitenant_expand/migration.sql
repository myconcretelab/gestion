-- Multi-tenant expand/backfill migration for SQLite.
-- Historical organization ID is intentionally stable and is also used by the
-- compatibility defaults while application queries become tenant-aware.

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

CREATE TABLE "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "login_id" TEXT NOT NULL,
  "email" TEXT,
  "password_hash" TEXT,
  "password_salt" TEXT,
  "password_updated_at" DATETIME,
  "auth_version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "memberships" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'custom',
  "status" TEXT NOT NULL DEFAULT 'active',
  "permissions" TEXT NOT NULL DEFAULT '{}',
  "invited_at" DATETIME,
  "accepted_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "memberships_user_organization_key" ON "memberships"("user_id", "organization_id");
CREATE INDEX "memberships_organization_status_idx" ON "memberships"("organization_id", "status");

CREATE TABLE "organization_settings" (
  "organization_id" TEXT NOT NULL PRIMARY KEY,
  "profile_json" TEXT NOT NULL DEFAULT '{}',
  "locale" TEXT NOT NULL DEFAULT 'fr-FR',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  "branding_json" TEXT NOT NULL DEFAULT '{}',
  "documents_json" TEXT NOT NULL DEFAULT '{}',
  "modules_json" TEXT NOT NULL DEFAULT '{}',
  "setup_completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "organizations" ("id", "slug", "name", "status")
VALUES ('org_historical_broceliande', 'historique', 'Les Gîtes de Brocéliande', 'active');

INSERT INTO "organization_settings" (
  "organization_id", "profile_json", "locale", "currency", "timezone", "branding_json", "documents_json", "modules_json", "setup_completed"
)
SELECT
  'org_historical_broceliande', "organization_json",
  COALESCE(json_extract("organization_json", '$.locale'), 'fr-FR'),
  COALESCE(json_extract("organization_json", '$.currency'), 'EUR'),
  COALESCE(json_extract("organization_json", '$.timezone'), 'Europe/Paris'),
  "organization_json", "organization_json", "modules_json", "setup_completed"
FROM "installation_config" WHERE "id" = 'default';

INSERT INTO "organization_settings" ("organization_id")
SELECT 'org_historical_broceliande'
WHERE NOT EXISTS (SELECT 1 FROM "organization_settings" WHERE "organization_id" = 'org_historical_broceliande');

INSERT INTO "users" (
  "id", "login_id", "email", "password_hash", "password_salt", "password_updated_at", "auth_version", "createdAt", "updatedAt"
)
SELECT
  "id", COALESCE(NULLIF(trim("login_id"), ''), 'legacy:' || "id"),
  CASE WHEN "login_id" IS NOT NULL THEN NULLIF(lower(trim("email")), '') ELSE NULL END,
  "password_hash", "password_salt", "password_updated_at", "auth_version", "createdAt", "updatedAt"
FROM "app_users";

INSERT INTO "memberships" (
  "id", "user_id", "organization_id", "role", "status", "permissions", "accepted_at", "createdAt", "updatedAt"
)
SELECT
  'membership_' || "id", "id", 'org_historical_broceliande',
  CASE WHEN "is_owner" = true THEN 'owner' ELSE "status" END,
  CASE WHEN "is_active" = true THEN 'active' ELSE 'disabled' END,
  json_object('roles', json("roles"), 'pageAccess', json("page_access"), 'canWrite', "can_write", 'canViewAmounts', "can_view_amounts"),
  "createdAt", "createdAt", "updatedAt"
FROM "app_users";

ALTER TABLE "installation_config" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "content_template_versions" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gites" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_photos" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "wordpress_webhook_jobs" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gestionnaires" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "app_users" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "app_users" ADD COLUMN "user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "app_users" SET "user_id" = "id" WHERE "user_id" IS NULL;
ALTER TABLE "auth_sessions" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "api_tokens" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "document_shares" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_categories" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_recurring_rules" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "expense_entries" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "urssaf_declarations" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "guest_night_declarations" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "ical_sources" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "contrats" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "contrat_counters" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "factures" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "facture_counters" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "reservation_placeholders" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_periods" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_workers" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "intervenant_hour_entries" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "user_interventions" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "intervenant_expenses" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "planning_relay_assignments" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "reservations" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_season_rates" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "booking_requests" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';
ALTER TABLE "gite_monthly_energy_readings" ADD COLUMN "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande';

DROP INDEX "content_template_versions_key_version_key";
DROP INDEX "gites_public_slug_key";
DROP INDEX "gestionnaires_prenom_nom_key";
DROP INDEX "expense_categories_scope_name_key";
DROP INDEX "urssaf_declarations_period_manager_key";
DROP INDEX "guest_night_declarations_period_gite_key";
DROP INDEX "ical_sources_gite_url_key";
DROP INDEX "contrats_numero_contrat_key";
DROP INDEX "contrat_counters_giteId_year_key";
DROP INDEX "factures_numero_facture_key";
DROP INDEX "facture_counters_giteId_year_key";
DROP INDEX "reservation_placeholders_abbreviation_key";
DROP INDEX "user_interventions_source_key_key";
DROP INDEX "planning_relay_assignments_period_date_gite_key";
DROP INDEX "gite_monthly_energy_readings_period_device_key";

CREATE UNIQUE INDEX "content_template_versions_org_key_version_key" ON "content_template_versions"("organization_id", "template_key", "version");
CREATE UNIQUE INDEX "gites_org_public_slug_key" ON "gites"("organization_id", "public_slug");
CREATE UNIQUE INDEX "gestionnaires_organization_id_prenom_nom_key" ON "gestionnaires"("organization_id", "prenom", "nom");
CREATE UNIQUE INDEX "app_users_org_user_key" ON "app_users"("organization_id", "user_id");
CREATE INDEX "app_users_org_active_name_idx" ON "app_users"("organization_id", "is_active", "display_name");
CREATE UNIQUE INDEX "expense_categories_org_scope_name_key" ON "expense_categories"("organization_id", "scope", "name");
CREATE UNIQUE INDEX "urssaf_declarations_org_period_manager_key" ON "urssaf_declarations"("organization_id", "year", "month", "gestionnaire_id");
CREATE UNIQUE INDEX "guest_night_declarations_org_period_gite_key" ON "guest_night_declarations"("organization_id", "year", "month", "gite_id");
CREATE UNIQUE INDEX "ical_sources_org_gite_url_key" ON "ical_sources"("organization_id", "gite_id", "url");
CREATE UNIQUE INDEX "contrats_org_numero_key" ON "contrats"("organization_id", "numero_contrat");
CREATE UNIQUE INDEX "contrat_counters_organization_id_giteId_year_key" ON "contrat_counters"("organization_id", "giteId", "year");
CREATE UNIQUE INDEX "factures_org_numero_key" ON "factures"("organization_id", "numero_facture");
CREATE UNIQUE INDEX "facture_counters_organization_id_giteId_year_key" ON "facture_counters"("organization_id", "giteId", "year");
CREATE UNIQUE INDEX "reservation_placeholders_org_abbreviation_key" ON "reservation_placeholders"("organization_id", "abbreviation");
CREATE UNIQUE INDEX "user_interventions_org_source_key" ON "user_interventions"("organization_id", "source_key");
CREATE UNIQUE INDEX "planning_relay_assignments_org_period_date_gite_key" ON "planning_relay_assignments"("organization_id", "period_id", "date", "gite_id");
CREATE UNIQUE INDEX "gite_monthly_energy_readings_org_period_device_key" ON "gite_monthly_energy_readings"("organization_id", "gite_id", "year", "month", "device_id");
