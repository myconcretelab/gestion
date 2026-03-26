ALTER TABLE "contrats" ADD COLUMN "date_envoi_email" TIMESTAMP(3);
ALTER TABLE "contrats" ADD COLUMN "statut_reception_contrat" TEXT NOT NULL DEFAULT 'non_recu';
ALTER TABLE "contrats" ADD COLUMN "date_reception_contrat" TIMESTAMP(3);
ALTER TABLE "contrats" ADD COLUMN "date_paiement_arrhes" TIMESTAMP(3);
