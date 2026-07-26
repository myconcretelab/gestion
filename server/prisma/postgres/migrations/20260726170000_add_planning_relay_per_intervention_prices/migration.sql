ALTER TABLE "planning_relay_periods" ADD COLUMN "intervention_prices" JSONB NOT NULL DEFAULT '{}'::jsonb;
