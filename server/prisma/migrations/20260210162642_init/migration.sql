-- CreateTable
CREATE TABLE "gites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nom" TEXT NOT NULL,
    "prefixe_contrat" TEXT NOT NULL,
    "adresse_ligne1" TEXT NOT NULL,
    "adresse_ligne2" TEXT,
    "capacite_max" INTEGER NOT NULL,
    "proprietaires_noms" TEXT NOT NULL,
    "proprietaires_adresse" TEXT NOT NULL,
    "site_web" TEXT,
    "email" TEXT,
    "telephones" TEXT NOT NULL,
    "taxe_sejour_par_personne_par_nuit" REAL NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "titulaire" TEXT NOT NULL,
    "regle_animaux_acceptes" BOOLEAN NOT NULL DEFAULT false,
    "regle_bois_premiere_flambee" BOOLEAN NOT NULL DEFAULT false,
    "regle_tiers_personnes_info" BOOLEAN NOT NULL DEFAULT false,
    "options_draps_par_lit" REAL NOT NULL DEFAULT 0,
    "options_linge_toilette_par_personne" REAL NOT NULL DEFAULT 0,
    "options_menage_forfait" REAL NOT NULL DEFAULT 0,
    "options_depart_tardif_forfait" REAL NOT NULL DEFAULT 0,
    "options_chiens_forfait" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "contrats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero_contrat" TEXT NOT NULL,
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
    "clauses" TEXT NOT NULL,
    "pdf_path" TEXT NOT NULL,
    "statut_paiement_arrhes" TEXT NOT NULL DEFAULT 'non_recu',
    "notes" TEXT,
    CONSTRAINT "contrats_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contrat_counters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "giteId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    CONSTRAINT "contrat_counters_giteId_fkey" FOREIGN KEY ("giteId") REFERENCES "gites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "contrats_numero_contrat_key" ON "contrats"("numero_contrat");

-- CreateIndex
CREATE UNIQUE INDEX "contrat_counters_giteId_year_key" ON "contrat_counters"("giteId", "year");
