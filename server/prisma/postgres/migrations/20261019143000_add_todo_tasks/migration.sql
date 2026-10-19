ALTER TABLE "action_templates" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'short';
ALTER TABLE "action_templates" ADD COLUMN "compensation_mode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "action_templates" ADD COLUMN "compensation_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "action_templates" ADD COLUMN "default_minutes" INTEGER;

ALTER TABLE "action_tasks" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'short';
ALTER TABLE "action_tasks" ADD COLUMN "compensation_mode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "action_tasks" ADD COLUMN "compensation_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "action_tasks" ADD COLUMN "spent_minutes" INTEGER;
ALTER TABLE "action_tasks" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX "action_tasks_org_gite_category_status_idx"
ON "action_tasks"("organization_id", "gite_id", "category", "status");
