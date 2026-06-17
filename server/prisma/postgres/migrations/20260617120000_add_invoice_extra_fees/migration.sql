ALTER TABLE "factures" ADD COLUMN "frais_supplementaires" JSONB NOT NULL DEFAULT '[]'::jsonb;
