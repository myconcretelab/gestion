ALTER TABLE "cleaning_rules" ADD COLUMN "assignment_mode" TEXT NOT NULL DEFAULT 'unassigned';
ALTER TABLE "cleaning_rules" ADD COLUMN "rotation_assignee_ids" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "cleaning_rules" ADD COLUMN "rotation_cursor" INTEGER NOT NULL DEFAULT 0;
UPDATE "cleaning_rules" SET "assignment_mode" = 'fixed' WHERE "default_assignee_id" IS NOT NULL;

CREATE TABLE "action_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "gite_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "trigger_event" TEXT NOT NULL,
  "starts_offset_days" INTEGER NOT NULL DEFAULT 0,
  "due_offset_days" INTEGER NOT NULL DEFAULT 0,
  "start_time" TEXT NOT NULL DEFAULT '09:00',
  "due_time" TEXT NOT NULL DEFAULT '17:00',
  "assignment_mode" TEXT NOT NULL DEFAULT 'unassigned',
  "default_assignee_id" TEXT,
  "rotation_assignee_ids" TEXT NOT NULL DEFAULT '[]',
  "rotation_cursor" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "action_templates_org_gite_enabled_idx" ON "action_templates"("organization_id", "gite_id", "enabled");

CREATE TABLE "action_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
  "template_id" TEXT,
  "reservation_id" TEXT,
  "gite_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "assignee_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "starts_at" DATETIME NOT NULL,
  "due_at" DATETIME NOT NULL,
  "completed_at" DATETIME,
  "completed_by_id" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "action_tasks_org_template_reservation_key" ON "action_tasks"("organization_id", "template_id", "reservation_id");
CREATE INDEX "action_tasks_org_starts_idx" ON "action_tasks"("organization_id", "starts_at");
CREATE INDEX "action_tasks_org_assignee_status_idx" ON "action_tasks"("organization_id", "assignee_id", "status");
