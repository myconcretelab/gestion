-- CreateTable
CREATE TABLE "invoice_sequences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "fiscal_entity_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "last_issued_at" DATETIME NOT NULL,
    CONSTRAINT "invoice_sequences_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_factures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lifecycle_status" TEXT NOT NULL DEFAULT 'legacy',
    "document_kind" TEXT NOT NULL DEFAULT 'invoice',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "issued_at" DATETIME,
    "fiscal_entity_id" TEXT,
    "fiscal_establishment_id" TEXT,
    "calculation_snapshot" TEXT,
    "immutable_snapshot" TEXT,
    "pdf_sha256" TEXT,
    "credited_invoice_id" TEXT,
    "numero_facture" TEXT NOT NULL,
    "gite_id" TEXT NOT NULL,
    "date_creation" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_derniere_modif" DATETIME NOT NULL,
    "locataire_nom" TEXT NOT NULL,
    "locataire_adresse" TEXT NOT NULL,
    "locataire_tel" TEXT NOT NULL,
    "locataire_email" TEXT,
    "nb_adultes" INTEGER NOT NULL,
    "nb_enfants_2_17" INTEGER NOT NULL,
    "date_debut" DATETIME NOT NULL,
    "heure_arrivee" TEXT NOT NULL,
    "date_fin" DATETIME NOT NULL,
    "heure_depart" TEXT NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "prix_par_nuit" REAL NOT NULL,
    "remise_montant" REAL NOT NULL DEFAULT 0,
    "frais_supplementaires" TEXT NOT NULL DEFAULT '[]',
    "reservation_items" TEXT NOT NULL DEFAULT '[]',
    "taxe_sejour_calculee" REAL,
    "options" TEXT NOT NULL,
    "arrhes_montant" REAL NOT NULL,
    "arrhes_date_limite" DATETIME NOT NULL,
    "solde_montant" REAL NOT NULL,
    "caution_montant" REAL NOT NULL,
    "cheque_menage_montant" REAL NOT NULL,
    "afficher_caution_phrase" BOOLEAN NOT NULL DEFAULT true,
    "afficher_cheque_menage_phrase" BOOLEAN NOT NULL DEFAULT true,
    "clauses" TEXT NOT NULL,
    "pdf_path" TEXT NOT NULL,
    "date_envoi_email" DATETIME,
    "statut_paiement" TEXT NOT NULL DEFAULT 'non_reglee',
    "notes" TEXT,
    "reservation_id" TEXT,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    CONSTRAINT "factures_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "factures_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "factures_fiscal_establishment_id_organization_id_fkey" FOREIGN KEY ("fiscal_establishment_id", "organization_id") REFERENCES "fiscal_establishments" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "factures_credited_invoice_id_organization_id_fkey" FOREIGN KEY ("credited_invoice_id", "organization_id") REFERENCES "factures" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_factures" ("afficher_caution_phrase", "afficher_cheque_menage_phrase", "arrhes_date_limite", "arrhes_montant", "caution_montant", "cheque_menage_montant", "clauses", "date_creation", "date_debut", "date_derniere_modif", "date_envoi_email", "date_fin", "frais_supplementaires", "gite_id", "heure_arrivee", "heure_depart", "id", "locataire_adresse", "locataire_email", "locataire_nom", "locataire_tel", "nb_adultes", "nb_enfants_2_17", "nb_nuits", "notes", "numero_facture", "options", "organization_id", "pdf_path", "prix_par_nuit", "remise_montant", "reservation_id", "reservation_items", "solde_montant", "statut_paiement", "taxe_sejour_calculee") SELECT "afficher_caution_phrase", "afficher_cheque_menage_phrase", "arrhes_date_limite", "arrhes_montant", "caution_montant", "cheque_menage_montant", "clauses", "date_creation", "date_debut", "date_derniere_modif", "date_envoi_email", "date_fin", "frais_supplementaires", "gite_id", "heure_arrivee", "heure_depart", "id", "locataire_adresse", "locataire_email", "locataire_nom", "locataire_tel", "nb_adultes", "nb_enfants_2_17", "nb_nuits", "notes", "numero_facture", "options", "organization_id", "pdf_path", "prix_par_nuit", "remise_montant", "reservation_id", "reservation_items", "solde_montant", "statut_paiement", "taxe_sejour_calculee" FROM "factures";
DROP TABLE "factures";
ALTER TABLE "new_factures" RENAME TO "factures";
CREATE INDEX "factures_org_lifecycle_issued_idx" ON "factures"("organization_id", "lifecycle_status", "issued_at");
CREATE INDEX "factures_reservation_id_idx" ON "factures"("reservation_id");
CREATE UNIQUE INDEX "factures_org_numero_key" ON "factures"("organization_id", "numero_facture");
CREATE UNIQUE INDEX "factures_id_org_key" ON "factures"("id", "organization_id");
CREATE UNIQUE INDEX "factures_org_credited_invoice_key" ON "factures"("organization_id", "credited_invoice_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_org_entity_year_key" ON "invoice_sequences"("organization_id", "fiscal_entity_id", "year");

-- Existing numbered invoices are historical documents, never new drafts.
-- Do not invent an issuance date or rebuild their PDF during this migration.
UPDATE "factures" SET "lifecycle_status" = 'legacy';
