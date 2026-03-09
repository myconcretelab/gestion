ALTER TABLE "reservations"
  ADD COLUMN "remise_montant" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "commission_channel_mode" TEXT DEFAULT 'euro',
  ADD COLUMN "commission_channel_value" NUMERIC(10,2) NOT NULL DEFAULT 0;
