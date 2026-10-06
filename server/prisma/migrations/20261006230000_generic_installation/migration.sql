CREATE TABLE "installation_config" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  "organization_json" TEXT NOT NULL DEFAULT '{}',
  "modules_json" TEXT NOT NULL DEFAULT '{}',
  "setup_completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "content_template_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "template_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "subject" TEXT,
  "content" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "content_template_versions_key_version_key" ON "content_template_versions"("template_key", "version");
CREATE INDEX "content_template_versions_active_idx" ON "content_template_versions"("template_key", "is_active");

-- Existing installations keep their identity and all previously available modules.
-- A fresh database has no gite and receives no row: runtime defaults remain neutral
-- and every optional module stays disabled until onboarding is completed.
INSERT INTO "installation_config" (
  "id", "organization_json", "modules_json", "setup_completed", "updatedAt"
)
SELECT
  'default',
  json_object(
    'tradeName', 'Les Gîtes de Brocéliande',
    'legalName', COALESCE("proprietaires_noms", ''),
    'addressLine1', COALESCE("proprietaires_adresse", ''),
    'addressLine2', '',
    'postalCode', '',
    'city', '',
    'country', 'FR',
    'email', COALESCE("email", ''),
    'phone', '',
    'website', COALESCE("site_web", ''),
    'iban', COALESCE("iban", ''),
    'bic', COALESCE("bic", ''),
    'bankAccountHolder', COALESCE("titulaire", ''),
    'locale', 'fr-FR',
    'currency', 'EUR',
    'timezone', 'Europe/Paris',
    'logoUrl', '/logo.png',
    'faviconUrl', '/favicon.ico',
    'primaryColor', '#315f4b',
    'emailSignature', 'Les Gîtes de Brocéliande',
    'smsSignature', 'Les Gîtes de Brocéliande',
    'documentFooter', 'Les Gîtes de Brocéliande',
    'publicDisplayName', 'Les Gîtes de Brocéliande'
  ),
  '{"reservations":true,"contracts":true,"invoices":true,"finances":true,"personal_expenses":true,"worker_planning":true,"web_publication":true,"ical":true,"pump_airbnb":true,"smart_life":true,"sms":true,"telegram":true,"daily_email":true}',
  true,
  CURRENT_TIMESTAMP
FROM "gites"
ORDER BY "ordre" ASC
LIMIT 1;
