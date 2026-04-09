CREATE TABLE "guest_night_declarations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "gite_id" TEXT NOT NULL,
    "guest_nights" INTEGER NOT NULL DEFAULT 0,
    "declared_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guest_night_declarations_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "guest_night_declarations_period_gite_key" ON "guest_night_declarations"("year", "month", "gite_id");
CREATE INDEX "guest_night_declarations_period_idx" ON "guest_night_declarations"("year", "month");
CREATE INDEX "guest_night_declarations_gite_idx" ON "guest_night_declarations"("gite_id");
