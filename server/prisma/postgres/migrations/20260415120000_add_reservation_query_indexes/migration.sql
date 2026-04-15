CREATE INDEX "reservations_gite_id_date_sortie_idx" ON "reservations"("gite_id", "date_sortie");

CREATE INDEX "reservations_date_entree_createdAt_idx" ON "reservations"("date_entree", "createdAt");

CREATE INDEX "reservations_date_sortie_idx" ON "reservations"("date_sortie");

CREATE INDEX "reservations_createdAt_date_entree_idx" ON "reservations"("createdAt", "date_entree");

CREATE INDEX "reservations_updatedAt_createdAt_idx" ON "reservations"("updatedAt", "createdAt");

CREATE INDEX "reservations_origin_system_createdAt_idx" ON "reservations"("origin_system", "createdAt");

CREATE INDEX "reservations_placeholder_id_date_sortie_idx" ON "reservations"("placeholder_id", "date_sortie");
