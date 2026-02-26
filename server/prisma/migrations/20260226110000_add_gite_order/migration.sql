ALTER TABLE "gites" ADD COLUMN "ordre" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY nom ASC, id ASC) - 1 AS ordre
  FROM "gites"
)
UPDATE "gites"
SET "ordre" = (SELECT ranked.ordre FROM ranked WHERE ranked.id = "gites".id);

CREATE INDEX "gites_ordre_idx" ON "gites"("ordre");
