-- CreateTable
CREATE TABLE "gites" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prefixe_contrat" TEXT NOT NULL,
    "adresse_ligne1" TEXT NOT NULL,
    "adresse_ligne2" TEXT,
    "capacite_max" INTEGER NOT NULL,
    "proprietaires_noms" TEXT NOT NULL,
    "proprietaires_adresse" TEXT NOT NULL,
    "site_web" TEXT,
    "email" TEXT,
    "telephones" JSONB NOT NULL,
    "taxe_sejour_par_personne_par_nuit" DECIMAL(10,2) NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "titulaire" TEXT NOT NULL,
    "regle_animaux_acceptes" BOOLEAN NOT NULL DEFAULT false,
    "regle_bois_premiere_flambee" BOOLEAN NOT NULL DEFAULT false,
    "regle_tiers_personnes_info" BOOLEAN NOT NULL DEFAULT false,
    "options_draps_par_lit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "options_linge_toilette_par_personne" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "options_menage_forfait" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "options_depart_tardif_forfait" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "options_chiens_forfait" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "caution_montant_defaut" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cheque_menage_montant_defaut" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "arrhes_taux_defaut" DECIMAL(5,4) NOT NULL DEFAULT 0.2,
    "prix_nuit_liste" JSONB,
    "caracteristiques" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrats" (
    "id" TEXT NOT NULL,
    "numero_contrat" TEXT NOT NULL,
    "gite_id" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_derniere_modif" TIMESTAMP(3) NOT NULL,
    "locataire_nom" TEXT NOT NULL,
    "locataire_adresse" TEXT NOT NULL,
    "locataire_tel" TEXT NOT NULL,
    "nb_adultes" INTEGER NOT NULL,
    "nb_enfants_2_17" INTEGER NOT NULL,
    "date_debut" TIMESTAMP(3) NOT NULL,
    "heure_arrivee" TEXT NOT NULL,
    "date_fin" TIMESTAMP(3) NOT NULL,
    "heure_depart" TEXT NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "prix_par_nuit" DECIMAL(10,2) NOT NULL,
    "remise_montant" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxe_sejour_calculee" DECIMAL(10,2),
    "options" JSONB NOT NULL,
    "arrhes_montant" DECIMAL(10,2) NOT NULL,
    "arrhes_date_limite" TIMESTAMP(3) NOT NULL,
    "solde_montant" DECIMAL(10,2) NOT NULL,
    "caution_montant" DECIMAL(10,2) NOT NULL,
    "cheque_menage_montant" DECIMAL(10,2) NOT NULL,
    "afficher_caution_phrase" BOOLEAN NOT NULL DEFAULT true,
    "afficher_cheque_menage_phrase" BOOLEAN NOT NULL DEFAULT true,
    "clauses" JSONB NOT NULL,
    "pdf_path" TEXT NOT NULL,
    "statut_paiement_arrhes" TEXT NOT NULL DEFAULT 'non_recu',
    "notes" TEXT,
    CONSTRAINT "contrats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrat_counters" (
    "id" TEXT NOT NULL,
    "giteId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    CONSTRAINT "contrat_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contrats_numero_contrat_key" ON "contrats"("numero_contrat");

-- CreateIndex
CREATE UNIQUE INDEX "contrat_counters_giteId_year_key" ON "contrat_counters"("giteId", "year");

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrat_counters" ADD CONSTRAINT "contrat_counters_giteId_fkey" FOREIGN KEY ("giteId") REFERENCES "gites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
