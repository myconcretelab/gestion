CREATE TABLE "ical_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gite_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "include_summary" TEXT,
    "exclude_summary" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ical_sources_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ical_sources_gite_url_key" ON "ical_sources"("gite_id", "url");
CREATE INDEX "ical_sources_gite_id_ordre_idx" ON "ical_sources"("gite_id", "ordre");
CREATE INDEX "ical_sources_is_active_idx" ON "ical_sources"("is_active");
