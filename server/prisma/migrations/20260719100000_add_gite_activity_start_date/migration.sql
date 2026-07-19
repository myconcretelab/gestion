ALTER TABLE "gites" ADD COLUMN "date_debut_activite" DATETIME;

UPDATE "gites"
SET "date_debut_activite" = (
  SELECT MIN("date_entree")
  FROM "reservations"
  WHERE "reservations"."gite_id" = "gites"."id"
);
