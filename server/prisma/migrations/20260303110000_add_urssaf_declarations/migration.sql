CREATE TABLE "urssaf_declarations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "gestionnaire_id" TEXT NOT NULL,
    "declared_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "urssaf_declarations_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "urssaf_declarations_period_manager_key" ON "urssaf_declarations"("year", "month", "gestionnaire_id");
CREATE INDEX "urssaf_declarations_period_idx" ON "urssaf_declarations"("year", "month");
CREATE INDEX "urssaf_declarations_manager_idx" ON "urssaf_declarations"("gestionnaire_id");
