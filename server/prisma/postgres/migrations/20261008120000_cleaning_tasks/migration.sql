CREATE TABLE "cleaning_rules" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "gite_id" TEXT NOT NULL,
  "generation_mode" TEXT NOT NULL DEFAULT 'always',
  "schedule_mode" TEXT NOT NULL DEFAULT 'after_departure',
  "default_assignee_id" TEXT,
  "requires_check" BOOLEAN NOT NULL DEFAULT true,
  "notify_on_complete" BOOLEAN NOT NULL DEFAULT false,
  "reminder_minutes" INTEGER NOT NULL DEFAULT 60,
  "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cleaning_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cleaning_rules_org_gite_key" ON "cleaning_rules"("organization_id", "gite_id");

CREATE TABLE "cleaning_tasks" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "gite_id" TEXT NOT NULL,
  "departure_reservation_id" TEXT NOT NULL,
  "arrival_reservation_id" TEXT,
  "assignee_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "completed_by_id" TEXT,
  "checked_at" TIMESTAMP(3),
  "checked_by_id" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cleaning_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cleaning_tasks_org_departure_key" ON "cleaning_tasks"("organization_id", "departure_reservation_id");
CREATE INDEX "cleaning_tasks_org_starts_idx" ON "cleaning_tasks"("organization_id", "starts_at");
CREATE INDEX "cleaning_tasks_org_assignee_status_idx" ON "cleaning_tasks"("organization_id", "assignee_id", "status");
