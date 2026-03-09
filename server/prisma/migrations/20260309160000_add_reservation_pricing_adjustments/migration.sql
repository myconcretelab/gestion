ALTER TABLE "reservations" ADD COLUMN "remise_montant" REAL NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN "commission_channel_mode" TEXT DEFAULT 'euro';
ALTER TABLE "reservations" ADD COLUMN "commission_channel_value" REAL NOT NULL DEFAULT 0;
