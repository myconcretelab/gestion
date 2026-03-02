-- CreateTable
CREATE TABLE "reservation_placeholders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "abbreviation" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gite_id" TEXT,
    "placeholder_id" TEXT,
    "hote_nom" TEXT NOT NULL,
    "date_entree" DATETIME NOT NULL,
    "date_sortie" DATETIME NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "nb_adultes" INTEGER NOT NULL,
    "prix_par_nuit" REAL NOT NULL,
    "prix_total" REAL NOT NULL,
    "source_paiement" TEXT,
    "commentaire" TEXT,
    "frais_optionnels_montant" REAL NOT NULL DEFAULT 0,
    "frais_optionnels_libelle" TEXT,
    "frais_optionnels_declares" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reservations_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reservations_placeholder_id_fkey" FOREIGN KEY ("placeholder_id") REFERENCES "reservation_placeholders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_placeholders_abbreviation_key" ON "reservation_placeholders"("abbreviation");

-- CreateIndex
CREATE INDEX "reservations_gite_id_date_entree_idx" ON "reservations"("gite_id", "date_entree");

-- CreateIndex
CREATE INDEX "reservations_placeholder_id_date_entree_idx" ON "reservations"("placeholder_id", "date_entree");
