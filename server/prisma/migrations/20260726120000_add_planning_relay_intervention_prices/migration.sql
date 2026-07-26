ALTER TABLE "gites" ADD COLUMN "prix_intervention" REAL NOT NULL DEFAULT 0;

ALTER TABLE "planning_relay_periods" ADD COLUMN "show_intervention_prices" BOOLEAN NOT NULL DEFAULT false;
