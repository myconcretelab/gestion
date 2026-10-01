ALTER TABLE "planning_relay_workers" ADD COLUMN "show_on_today" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "intervenant_hour_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "intervenant_id" TEXT,
  "intervenant_nom" TEXT NOT NULL,
  "worked_on" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL CHECK ("minutes" > 0 AND "minutes" <= 1440),
  "deleted_at" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "intervenant_hour_entries_intervenant_id_fkey" FOREIGN KEY ("intervenant_id") REFERENCES "planning_relay_workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "intervenant_hours_date_worker_idx" ON "intervenant_hour_entries" ("worked_on", "intervenant_id");
