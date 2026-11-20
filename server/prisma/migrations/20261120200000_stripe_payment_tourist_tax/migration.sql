ALTER TABLE "booking_payments" ADD COLUMN "quoted_tourist_tax_cents" INTEGER;
ALTER TABLE "booking_payments" ADD COLUMN "tourist_tax_details" TEXT;

CREATE TRIGGER "report_cache_stripe_payment_tax_update" AFTER UPDATE OF "tourist_tax_details" ON "booking_payments"
WHEN OLD."tourist_tax_details" IS NOT NEW."tourist_tax_details"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;
