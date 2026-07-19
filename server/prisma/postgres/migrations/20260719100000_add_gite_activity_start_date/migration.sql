ALTER TABLE "gites" ADD COLUMN "date_debut_activite" TIMESTAMP(3);

UPDATE "gites"
SET "date_debut_activite" = first_reservation."date_debut_activite"
FROM (
  SELECT "gite_id", MIN("date_entree") AS "date_debut_activite"
  FROM "reservations"
  WHERE "gite_id" IS NOT NULL
  GROUP BY "gite_id"
) AS first_reservation
WHERE "gites"."id" = first_reservation."gite_id";
