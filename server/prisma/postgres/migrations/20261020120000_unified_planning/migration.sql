ALTER TABLE "planning_relay_periods" ADD COLUMN "organization_config" TEXT;
ALTER TABLE "action_templates" ADD COLUMN "planning_period_id" TEXT;
ALTER TABLE "action_templates" ADD COLUMN "planning_mission_id" TEXT;
ALTER TABLE "action_templates" ADD COLUMN "active_from" TEXT;
ALTER TABLE "action_templates" ADD COLUMN "active_to" TEXT;
ALTER TABLE "action_templates" ADD COLUMN "minimum_nights" INTEGER;
ALTER TABLE "action_templates" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cleaning_tasks" ADD COLUMN "assignment_source" TEXT NOT NULL DEFAULT 'rule';
ALTER TABLE "cleaning_tasks" ADD COLUMN "assignment_period_id" TEXT;
ALTER TABLE "cleaning_tasks" ADD COLUMN "previous_assignee_id" TEXT;
ALTER TABLE "cleaning_tasks" ADD COLUMN "amount_snapshot" DOUBLE PRECISION;

-- Preserve existing explicit assignments. Fixed assignments matching their rule remain replaceable.
UPDATE "cleaning_tasks" SET "assignment_source" = 'manual'
WHERE "assignee_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "cleaning_rules" r
  WHERE r."organization_id" = "cleaning_tasks"."organization_id"
    AND r."gite_id" = "cleaning_tasks"."gite_id"
    AND r."assignment_mode" = 'fixed'
    AND r."default_assignee_id" = "cleaning_tasks"."assignee_id"
);
