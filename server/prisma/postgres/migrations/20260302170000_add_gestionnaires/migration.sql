CREATE TABLE "gestionnaires" (
    "id" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gestionnaires_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gestionnaires_prenom_nom_key" ON "gestionnaires"("prenom", "nom");

ALTER TABLE "gites" ADD COLUMN "gestionnaire_id" TEXT;

ALTER TABLE "gites" ADD CONSTRAINT "gites_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gites_gestionnaire_id_idx" ON "gites"("gestionnaire_id");
