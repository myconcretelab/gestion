-- Cached facts may serve report commands only when every source edit invalidates them.
CREATE TRIGGER "report_cache_gite_address_update" AFTER UPDATE OF "adresse_ligne1", "adresse_ligne2" ON "gites"
FOR EACH ROW WHEN (OLD."adresse_ligne1" IS DISTINCT FROM NEW."adresse_ligne1" OR OLD."adresse_ligne2" IS DISTINCT FROM NEW."adresse_ligne2")
EXECUTE FUNCTION invalidate_finance_report_cache();

CREATE TRIGGER "report_cache_reservation_register_update" AFTER UPDATE OF "prix_par_nuit", "origin_system" ON "reservations"
FOR EACH ROW WHEN (OLD."prix_par_nuit" IS DISTINCT FROM NEW."prix_par_nuit" OR OLD."origin_system" IS DISTINCT FROM NEW."origin_system")
EXECUTE FUNCTION invalidate_finance_report_cache();

CREATE TRIGGER "report_cache_booking_request_order_update" AFTER UPDATE OF "createdAt" ON "booking_requests"
FOR EACH ROW WHEN (OLD."createdAt" IS DISTINCT FROM NEW."createdAt")
EXECUTE FUNCTION invalidate_finance_report_cache();
