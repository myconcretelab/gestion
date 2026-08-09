PRAGMA foreign_keys=OFF;

CREATE TABLE "new_intervenant_expenses" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "intervenant_id" TEXT,
  "intervenant_nom" TEXT,
  "label" TEXT NOT NULL DEFAULT 'Frais ponctuel',
  "scope" TEXT NOT NULL DEFAULT 'all_gites',
  "gite_id" TEXT,
  "gite_nom" TEXT,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "amount" REAL NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "intervenant_expenses_intervenant_id_fkey"
    FOREIGN KEY ("intervenant_id") REFERENCES "planning_relay_workers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "intervenant_expenses_gite_id_fkey"
    FOREIGN KEY ("gite_id") REFERENCES "gites" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_intervenant_expenses" (
  "id", "intervenant_id", "intervenant_nom", "label", "scope", "gite_id",
  "gite_nom", "year", "month", "amount", "notes", "createdAt", "updatedAt"
)
SELECT
  expense."id", expense."intervenant_id", worker."nom", 'Frais ponctuel',
  expense."scope", expense."gite_id", expense."gite_nom", expense."year",
  expense."month", expense."amount", expense."notes", expense."createdAt",
  expense."updatedAt"
FROM "intervenant_expenses" expense
LEFT JOIN "planning_relay_workers" worker ON worker."id" = expense."intervenant_id";

DROP TABLE "intervenant_expenses";
ALTER TABLE "new_intervenant_expenses" RENAME TO "intervenant_expenses";

CREATE INDEX "intervenant_expenses_year_month_idx" ON "intervenant_expenses"("year", "month");
CREATE INDEX "intervenant_expenses_intervenant_period_idx" ON "intervenant_expenses"("intervenant_id", "year", "month");
CREATE INDEX "intervenant_expenses_gite_idx" ON "intervenant_expenses"("gite_id");

PRAGMA foreign_keys=ON;
