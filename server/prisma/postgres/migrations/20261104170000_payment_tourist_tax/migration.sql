ALTER TABLE "reservation_recorded_payments" ADD COLUMN "tourist_tax_details" TEXT;

CREATE TRIGGER "report_cache_recorded_payment_tax_update" AFTER UPDATE OF "tourist_tax_details" ON "reservation_recorded_payments"
FOR EACH ROW WHEN (OLD."tourist_tax_details" IS DISTINCT FROM NEW."tourist_tax_details")
EXECUTE FUNCTION invalidate_finance_report_cache();
