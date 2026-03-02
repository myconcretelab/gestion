CREATE TABLE "gestionnaires" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "gestionnaires_prenom_nom_key" ON "gestionnaires"("prenom", "nom");

ALTER TABLE "gites" ADD COLUMN "gestionnaire_id" TEXT REFERENCES "gestionnaires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gites_gestionnaire_id_idx" ON "gites"("gestionnaire_id");
