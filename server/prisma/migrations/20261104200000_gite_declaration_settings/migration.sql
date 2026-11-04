-- Declaration identifiers affect report preparation and must invalidate cached sources.
CREATE TRIGGER "report_cache_gite_declaration_update" AFTER UPDATE OF "taxe_sejour_config" ON "gites"
WHEN OLD."taxe_sejour_config" IS NOT NEW."taxe_sejour_config"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;
