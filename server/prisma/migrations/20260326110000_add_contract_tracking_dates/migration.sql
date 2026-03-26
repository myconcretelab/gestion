ALTER TABLE "contrats" ADD COLUMN "date_envoi_email" DATETIME;
ALTER TABLE "contrats" ADD COLUMN "statut_reception_contrat" TEXT NOT NULL DEFAULT 'non_recu';
ALTER TABLE "contrats" ADD COLUMN "date_reception_contrat" DATETIME;
ALTER TABLE "contrats" ADD COLUMN "date_paiement_arrhes" DATETIME;
