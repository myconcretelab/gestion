ALTER TABLE "gites" ADD COLUMN "prix_nuit_basse_saison" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "gites" ADD COLUMN "prix_nuit_haute_saison" DECIMAL(10,2) NOT NULL DEFAULT 0;
