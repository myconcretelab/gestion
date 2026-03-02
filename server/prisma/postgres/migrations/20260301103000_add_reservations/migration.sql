-- CreateTable
CREATE TABLE "reservation_placeholders" (
    "id" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservation_placeholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "gite_id" TEXT,
    "placeholder_id" TEXT,
    "hote_nom" TEXT NOT NULL,
    "date_entree" TIMESTAMP(3) NOT NULL,
    "date_sortie" TIMESTAMP(3) NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "nb_adultes" INTEGER NOT NULL,
    "prix_par_nuit" DECIMAL(10,2) NOT NULL,
    "prix_total" DECIMAL(10,2) NOT NULL,
    "source_paiement" TEXT,
    "commentaire" TEXT,
    "frais_optionnels_montant" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "frais_optionnels_libelle" TEXT,
    "frais_optionnels_declares" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_placeholders_abbreviation_key" ON "reservation_placeholders"("abbreviation");

-- CreateIndex
CREATE INDEX "reservations_gite_id_date_entree_idx" ON "reservations"("gite_id", "date_entree");

-- CreateIndex
CREATE INDEX "reservations_placeholder_id_date_entree_idx" ON "reservations"("placeholder_id", "date_entree");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_placeholder_id_fkey" FOREIGN KEY ("placeholder_id") REFERENCES "reservation_placeholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
