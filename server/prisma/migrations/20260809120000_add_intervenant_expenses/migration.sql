CREATE TABLE "intervenant_expenses" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "intervenant_id" TEXT NOT NULL,
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
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intervenant_expenses_gite_id_fkey"
    FOREIGN KEY ("gite_id") REFERENCES "gites" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "intervenant_expenses_year_month_idx"
  ON "intervenant_expenses"("year", "month");
CREATE INDEX "intervenant_expenses_intervenant_period_idx"
  ON "intervenant_expenses"("intervenant_id", "year", "month");
CREATE INDEX "intervenant_expenses_gite_idx"
  ON "intervenant_expenses"("gite_id");
