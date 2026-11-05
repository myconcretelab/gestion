-- Rebuildable annual projections. Global source revisions continue to invalidate every year.
CREATE TABLE "finance_report_year_caches" (
  "organization_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "calculated_revision" INTEGER NOT NULL,
  "engine_version" INTEGER NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "calculated_month" TEXT NOT NULL,
  "workspace_json" TEXT NOT NULL,
  "reminders_json" TEXT NOT NULL,
  CONSTRAINT "finance_report_year_caches_pkey" PRIMARY KEY ("organization_id", "year"),
  CONSTRAINT "finance_report_year_caches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "booking_payments_org_paid_at_idx" ON "booking_payments" ("organization_id", "paid_at");
CREATE INDEX "reservation_recorded_payments_org_paid_on_idx" ON "reservation_recorded_payments" ("organization_id", "paid_on");
CREATE INDEX "contrats_org_date_paiement_arrhes_idx" ON "contrats" ("organization_id", "date_paiement_arrhes");
-- Discard obsolete full-history projections; immutable confirmations are in finance_report_stores.
UPDATE "finance_report_caches" SET "workspace_json" = NULL, "reminders_json" = NULL, "calculated_revision" = NULL;
