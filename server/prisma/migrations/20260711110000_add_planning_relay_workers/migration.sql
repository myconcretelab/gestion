CREATE TABLE "planning_relay_workers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "nom" TEXT NOT NULL,
  "telephone" TEXT NOT NULL,
  "email" TEXT,
  "adresse" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "planning_relay_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "period_id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "gite_id" TEXT NOT NULL,
  "worker_id" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planning_relay_assignments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "planning_relay_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "planning_relay_assignments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "planning_relay_workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "planning_relay_workers_active_nom_idx" ON "planning_relay_workers"("is_active", "nom");
CREATE UNIQUE INDEX "planning_relay_assignments_period_date_gite_key" ON "planning_relay_assignments"("period_id", "date", "gite_id");
CREATE INDEX "planning_relay_assignments_worker_idx" ON "planning_relay_assignments"("worker_id");
