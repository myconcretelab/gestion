-- AlterTable
ALTER TABLE "gites" ADD COLUMN "caution_montant_defaut" REAL NOT NULL DEFAULT 0;
ALTER TABLE "gites" ADD COLUMN "cheque_menage_montant_defaut" REAL NOT NULL DEFAULT 0;
