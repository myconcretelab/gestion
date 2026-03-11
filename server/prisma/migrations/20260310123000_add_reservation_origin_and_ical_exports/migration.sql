ALTER TABLE "gites" ADD COLUMN "ical_export_token" TEXT;
ALTER TABLE "reservations" ADD COLUMN "origin_system" TEXT;
ALTER TABLE "reservations" ADD COLUMN "origin_reference" TEXT;
ALTER TABLE "reservations" ADD COLUMN "export_to_ical" BOOLEAN;

UPDATE "gites"
SET "ical_export_token" = lower(hex(randomblob(16))) || lower(hex(randomblob(8)))
WHERE "ical_export_token" IS NULL OR trim("ical_export_token") = '';

UPDATE "reservations"
SET
  "origin_system" = 'ical',
  "export_to_ical" = 0
WHERE
  "origin_system" IS NULL
  AND (
    COALESCE("commentaire", '') LIKE '%[ICAL_TO_VERIFY]%'
    OR (
      COALESCE("prix_total", 0) = 0
      AND COALESCE("prix_par_nuit", 0) = 0
      AND lower(trim(COALESCE("source_paiement", ''))) IN ('', 'airbnb', 'a definir', 'a définir', 'abritel', 'gites de france', 'homeexchange')
    )
  );

UPDATE "reservations"
SET
  "origin_system" = 'app',
  "export_to_ical" = 1
WHERE "origin_system" IS NULL;

CREATE INDEX "gites_ical_export_token_idx" ON "gites"("ical_export_token");
CREATE INDEX "reservations_gite_export_to_ical_date_entree_idx" ON "reservations"("gite_id", "export_to_ical", "date_entree");
CREATE INDEX "reservations_origin_system_origin_reference_idx" ON "reservations"("origin_system", "origin_reference");
