ALTER TABLE "gites" ADD COLUMN "nb_adultes_habituel" INTEGER NOT NULL DEFAULT 1;

UPDATE "gites"
SET "nb_adultes_habituel" = "capacite_max";
