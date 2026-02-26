-- CreateTable
CREATE TABLE "factures" (
    "id" TEXT NOT NULL,
    "numero_facture" TEXT NOT NULL,
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
    "statut_paiement" TEXT NOT NULL DEFAULT 'non_reglee',
    "notes" TEXT,
    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facture_counters" (
    "id" TEXT NOT NULL,
    "giteId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    CONSTRAINT "facture_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factures_numero_facture_key" ON "factures"("numero_facture");

-- CreateIndex
CREATE UNIQUE INDEX "facture_counters_giteId_year_key" ON "facture_counters"("giteId", "year");

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facture_counters" ADD CONSTRAINT "facture_counters_giteId_fkey" FOREIGN KEY ("giteId") REFERENCES "gites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
