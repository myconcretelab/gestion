ALTER TABLE "reservations" ADD COLUMN "nb_enfants_2_17" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "gite_season_rates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gite_id" TEXT NOT NULL,
    "date_debut" DATETIME NOT NULL,
    "date_fin" DATETIME NOT NULL,
    "prix_par_nuit" REAL NOT NULL,
    "min_nuits" INTEGER NOT NULL DEFAULT 1,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gite_season_rates_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "booking_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gite_id" TEXT NOT NULL,
    "approved_reservation_id" TEXT,
    "hote_nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "date_entree" DATETIME NOT NULL,
    "date_sortie" DATETIME NOT NULL,
    "nb_nuits" INTEGER NOT NULL,
    "nb_adultes" INTEGER NOT NULL,
    "nb_enfants_2_17" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT NOT NULL DEFAULT '{}',
    "message_client" TEXT,
    "pricing_snapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hold_expires_at" DATETIME NOT NULL,
    "decided_at" DATETIME,
    "decision_note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "booking_requests_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "booking_requests_approved_reservation_id_fkey" FOREIGN KEY ("approved_reservation_id") REFERENCES "reservations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "gite_season_rates_gite_id_ordre_idx" ON "gite_season_rates"("gite_id", "ordre");
CREATE INDEX "gite_season_rates_gite_dates_idx" ON "gite_season_rates"("gite_id", "date_debut", "date_fin");
CREATE INDEX "booking_requests_gite_status_hold_idx" ON "booking_requests"("gite_id", "status", "hold_expires_at");
CREATE INDEX "booking_requests_gite_dates_idx" ON "booking_requests"("gite_id", "date_entree", "date_sortie");
CREATE INDEX "booking_requests_approved_reservation_idx" ON "booking_requests"("approved_reservation_id");
