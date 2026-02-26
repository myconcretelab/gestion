-- CreateTable
CREATE TABLE "factures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero_facture" TEXT NOT NULL,
    "gite_id" TEXT NOT NULL,
    "date_creation" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_derniere_modif" DATETIME NOT NULL,
    "locataire_nom" TEXT NOT NULL,
    "locataire_adresse" TEXT NOT NULL,
    "locataire_tel" TEXT NOT NULL,
    "nb_adultes" INTEGER NOT NULL,
    "nb_enfants_2_17" INTEGER NOT NULL,
    "date_debut" DATETIME NOT NULL,
    "heure_arrivee" TEXT NOT NULL,
    "date_fin" DATETIME NOT NULL,
    "heure_depart" TEXT NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "prix_par_nuit" REAL NOT NULL,
    "remise_montant" REAL NOT NULL DEFAULT 0,
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
    "statut_paiement" TEXT NOT NULL DEFAULT 'non_reglee',
    "notes" TEXT,
    CONSTRAINT "factures_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "facture_counters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "giteId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    CONSTRAINT "facture_counters_giteId_fkey" FOREIGN KEY ("giteId") REFERENCES "gites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "factures_numero_facture_key" ON "factures"("numero_facture");

-- CreateIndex
CREATE UNIQUE INDEX "facture_counters_giteId_year_key" ON "facture_counters"("giteId", "year");
