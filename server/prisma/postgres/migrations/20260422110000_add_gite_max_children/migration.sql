ALTER TABLE "gites" ADD COLUMN "nb_enfants_max" INTEGER NOT NULL DEFAULT 0;

UPDATE "gites"
SET "nb_enfants_max" = CASE
  WHEN "capacite_max" > "nb_adultes_max" THEN "capacite_max" - "nb_adultes_max"
  ELSE 0
END;
