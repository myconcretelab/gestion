-- A missing local SIREN is permitted only for a sandbox connection, never fabricated.
BEGIN;
ALTER TABLE "superpdp_connections" ALTER COLUMN "local_siren" DROP NOT NULL;
ALTER TABLE "superpdp_connections" ADD CONSTRAINT "superpdp_connections_siren_or_sandbox_check"
  CHECK ("local_siren" IS NOT NULL OR "environment" = 'sandbox');
COMMIT;
