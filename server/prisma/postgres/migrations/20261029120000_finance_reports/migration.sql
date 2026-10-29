CREATE TABLE "finance_report_stores" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "data_json" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_report_stores_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "finance_report_stores_organization_id_key" ON "finance_report_stores" ("organization_id");
ALTER TABLE "reservations" ADD COLUMN "reporting_amounts" TEXT;
