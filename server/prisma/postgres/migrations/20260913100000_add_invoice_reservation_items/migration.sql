ALTER TABLE "factures" ADD COLUMN "reservation_items" JSONB NOT NULL DEFAULT '[]'::jsonb;
