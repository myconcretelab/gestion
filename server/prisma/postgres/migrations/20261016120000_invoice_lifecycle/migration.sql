-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "calculation_snapshot" TEXT,
ADD COLUMN     "credited_invoice_id" TEXT,
ADD COLUMN     "document_kind" TEXT NOT NULL DEFAULT 'invoice',
ADD COLUMN     "fiscal_entity_id" TEXT,
ADD COLUMN     "fiscal_establishment_id" TEXT,
ADD COLUMN     "immutable_snapshot" TEXT,
ADD COLUMN     "issued_at" TIMESTAMP(3),
ADD COLUMN     "lifecycle_status" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "pdf_sha256" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "fiscal_entity_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "last_issued_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_org_entity_year_key" ON "invoice_sequences"("organization_id", "fiscal_entity_id", "year");

-- CreateIndex
CREATE INDEX "factures_org_lifecycle_issued_idx" ON "factures"("organization_id", "lifecycle_status", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "factures_id_org_key" ON "factures"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "factures_org_credited_invoice_key" ON "factures"("organization_id", "credited_invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_fiscal_establishment_id_organization_id_fkey" FOREIGN KEY ("fiscal_establishment_id", "organization_id") REFERENCES "fiscal_establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_credited_invoice_id_organization_id_fkey" FOREIGN KEY ("credited_invoice_id", "organization_id") REFERENCES "factures"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing numbered invoices are historical documents, never new drafts.
-- Do not invent an issuance date or rebuild their PDF during this migration.
UPDATE "factures" SET "lifecycle_status" = 'legacy';
