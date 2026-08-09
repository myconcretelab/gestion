ALTER TABLE "intervenant_expenses" ADD COLUMN "intervenant_nom" TEXT;
ALTER TABLE "intervenant_expenses" ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Frais ponctuel';

UPDATE "intervenant_expenses" expense
SET "intervenant_nom" = worker."nom"
FROM "planning_relay_workers" worker
WHERE worker."id" = expense."intervenant_id";

ALTER TABLE "intervenant_expenses" DROP CONSTRAINT "intervenant_expenses_intervenant_id_fkey";
ALTER TABLE "intervenant_expenses" ALTER COLUMN "intervenant_id" DROP NOT NULL;
ALTER TABLE "intervenant_expenses"
  ADD CONSTRAINT "intervenant_expenses_intervenant_id_fkey"
  FOREIGN KEY ("intervenant_id") REFERENCES "planning_relay_workers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
