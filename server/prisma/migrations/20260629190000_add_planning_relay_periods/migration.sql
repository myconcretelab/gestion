CREATE TABLE "planning_relay_periods" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "date_debut" DATETIME NOT NULL,
    "date_fin" DATETIME NOT NULL,
    "gite_ids" TEXT NOT NULL DEFAULT '[]',
    "show_timeline" BOOLEAN NOT NULL DEFAULT false,
    "show_comments" BOOLEAN NOT NULL DEFAULT false,
    "show_phones" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "share_nonce" TEXT NOT NULL,
    "expires_at" DATETIME,
    "last_accessed_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "planning_relay_periods_active_date_fin_idx"
ON "planning_relay_periods"("is_active", "date_fin");
