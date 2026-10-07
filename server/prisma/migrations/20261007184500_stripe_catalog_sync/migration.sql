CREATE TABLE "plan_price_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plan_id" TEXT NOT NULL,
    "billing_period" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "tax_behavior" TEXT NOT NULL DEFAULT 'unspecified',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plan_price_definitions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plan_price_definitions_plan_period_key" ON "plan_price_definitions"("plan_id", "billing_period");

CREATE TABLE "billing_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_product_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "billing_products_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_products_provider_product_key" ON "billing_products"("provider", "provider_product_id");
CREATE UNIQUE INDEX "billing_products_plan_provider_key" ON "billing_products"("plan_id", "provider");
