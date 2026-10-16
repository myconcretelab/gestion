-- AlterTable
ALTER TABLE "gites" ADD COLUMN     "fiscal_establishment_id" TEXT;

-- CreateTable
CREATE TABLE "fiscal_entities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "gestionnaire_id" TEXT,
    "legal_name" TEXT NOT NULL,
    "siren" TEXT,
    "vat_number" TEXT,
    "vat_regime" TEXT NOT NULL DEFAULT 'unknown',
    "address_line1" TEXT,
    "address_line2" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'FR',
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_establishments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "fiscal_entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'FR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_establishments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_entities_org_manager_idx" ON "fiscal_entities"("organization_id", "gestionnaire_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_entities_id_org_key" ON "fiscal_entities"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_entities_org_siren_key" ON "fiscal_entities"("organization_id", "siren");

-- CreateIndex
CREATE INDEX "fiscal_establishments_org_entity_idx" ON "fiscal_establishments"("organization_id", "fiscal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_establishments_id_org_key" ON "fiscal_establishments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_establishments_org_siret_key" ON "fiscal_establishments"("organization_id", "siret");

-- CreateIndex
CREATE INDEX "gites_org_fiscal_establishment_idx" ON "gites"("organization_id", "fiscal_establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "gestionnaires_id_org_key" ON "gestionnaires"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "gites" ADD CONSTRAINT "gites_fiscal_establishment_id_organization_id_fkey" FOREIGN KEY ("fiscal_establishment_id", "organization_id") REFERENCES "fiscal_establishments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_entities" ADD CONSTRAINT "fiscal_entities_gestionnaire_id_organization_id_fkey" FOREIGN KEY ("gestionnaire_id", "organization_id") REFERENCES "gestionnaires"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_establishments" ADD CONSTRAINT "fiscal_establishments_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
