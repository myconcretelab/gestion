ALTER TABLE "gites" ADD COLUMN "nb_adultes_max" INTEGER NOT NULL DEFAULT 1;

UPDATE "gites"
SET "nb_adultes_max" = "capacite_max"
WHERE "nb_adultes_max" = 1;
