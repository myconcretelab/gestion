ALTER TABLE "reservations" ADD COLUMN "email" TEXT;

ALTER TABLE "contrats" ADD COLUMN "locataire_email" TEXT;

ALTER TABLE "factures" ADD COLUMN "locataire_email" TEXT;
