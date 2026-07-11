PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_planning_relay_workers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "nom" TEXT NOT NULL,
  "telephone" TEXT NOT NULL,
  "email" TEXT,
  "adresse" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_planning_relay_workers" ("id", "nom", "telephone", "email", "adresse", "is_active", "createdAt", "updatedAt")
SELECT "id", "nom", "telephone", "email", "adresse", "is_active", "createdAt", "updatedAt" FROM "planning_relay_workers";

DROP TABLE "planning_relay_workers";
ALTER TABLE "new_planning_relay_workers" RENAME TO "planning_relay_workers";

CREATE INDEX "planning_relay_workers_active_nom_idx" ON "planning_relay_workers"("is_active", "nom");

CREATE TABLE "new_planning_relay_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "period_id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "gite_id" TEXT NOT NULL,
  "worker_id" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "planning_relay_assignments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "planning_relay_periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "planning_relay_assignments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "planning_relay_workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_planning_relay_assignments" ("id", "period_id", "date", "gite_id", "worker_id", "createdAt", "updatedAt")
SELECT "id", "period_id", "date", "gite_id", "worker_id", "createdAt", "updatedAt" FROM "planning_relay_assignments";

DROP TABLE "planning_relay_assignments";
ALTER TABLE "new_planning_relay_assignments" RENAME TO "planning_relay_assignments";

CREATE UNIQUE INDEX "planning_relay_assignments_period_date_gite_key" ON "planning_relay_assignments"("period_id", "date", "gite_id");
CREATE INDEX "planning_relay_assignments_worker_idx" ON "planning_relay_assignments"("worker_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
