-- Declaration identifiers affect report preparation and must invalidate cached sources.
CREATE TRIGGER "report_cache_gite_declaration_update" AFTER UPDATE OF "taxe_sejour_config" ON "gites"
FOR EACH ROW WHEN (OLD."taxe_sejour_config" IS DISTINCT FROM NEW."taxe_sejour_config")
EXECUTE FUNCTION invalidate_finance_report_cache();
