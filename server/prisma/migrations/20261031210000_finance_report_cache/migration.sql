-- Cached computations are separate from rules and immutable confirmations.
CREATE TABLE "finance_report_caches" (
  "organization_id" TEXT NOT NULL PRIMARY KEY,
  "source_revision" INTEGER NOT NULL DEFAULT 0,
  "calculated_revision" INTEGER,
  "engine_version" INTEGER NOT NULL DEFAULT 0,
  "calculated_at" DATETIME,
  "calculated_month" TEXT,
  "workspace_json" TEXT,
  "reminders_json" TEXT,
  CONSTRAINT "finance_report_caches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "finance_report_caches" ("organization_id") SELECT "id" FROM "organizations";

CREATE TRIGGER "finance_report_cache_organization_insert" AFTER INSERT ON "organizations"
BEGIN
  INSERT INTO "finance_report_caches" ("organization_id") VALUES (NEW."id");
END;

CREATE TRIGGER "report_cache_gites_insert" AFTER INSERT ON "gites"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_gites_update" AFTER UPDATE OF "id", "nom", "ordre", "gestionnaire_id", "fiscal_establishment_id", "arrhes_taux_defaut", "organization_id" ON "gites" WHEN (OLD."id" IS NOT NEW."id" OR OLD."nom" IS NOT NEW."nom" OR OLD."ordre" IS NOT NEW."ordre" OR OLD."gestionnaire_id" IS NOT NEW."gestionnaire_id" OR OLD."fiscal_establishment_id" IS NOT NEW."fiscal_establishment_id" OR OLD."arrhes_taux_defaut" IS NOT NEW."arrhes_taux_defaut" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_gites_delete" AFTER DELETE ON "gites"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_gestionnaires_insert" AFTER INSERT ON "gestionnaires"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_gestionnaires_update" AFTER UPDATE OF "id", "prenom", "nom", "organization_id" ON "gestionnaires" WHEN (OLD."id" IS NOT NEW."id" OR OLD."prenom" IS NOT NEW."prenom" OR OLD."nom" IS NOT NEW."nom" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_gestionnaires_delete" AFTER DELETE ON "gestionnaires"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_entities_insert" AFTER INSERT ON "fiscal_entities"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_entities_update" AFTER UPDATE OF "id", "legal_name", "vat_regime", "organization_id" ON "fiscal_entities" WHEN (OLD."id" IS NOT NEW."id" OR OLD."legal_name" IS NOT NEW."legal_name" OR OLD."vat_regime" IS NOT NEW."vat_regime" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_entities_delete" AFTER DELETE ON "fiscal_entities"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_establishments_insert" AFTER INSERT ON "fiscal_establishments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_establishments_update" AFTER UPDATE OF "id", "fiscal_entity_id", "organization_id" ON "fiscal_establishments" WHEN (OLD."id" IS NOT NEW."id" OR OLD."fiscal_entity_id" IS NOT NEW."fiscal_entity_id" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_fiscal_establishments_delete" AFTER DELETE ON "fiscal_establishments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_reservations_insert" AFTER INSERT ON "reservations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservations_update" AFTER UPDATE OF "id", "gite_id", "stay_group_id", "hote_nom", "date_entree", "date_sortie", "nb_nuits", "nb_adultes", "nb_enfants_2_17", "prix_total", "booking_source", "payments_managed", "source_paiement", "remise_montant", "frais_optionnels_montant", "options", "reporting_amounts", "organization_id" ON "reservations" WHEN (OLD."id" IS NOT NEW."id" OR OLD."gite_id" IS NOT NEW."gite_id" OR OLD."stay_group_id" IS NOT NEW."stay_group_id" OR OLD."hote_nom" IS NOT NEW."hote_nom" OR OLD."date_entree" IS NOT NEW."date_entree" OR OLD."date_sortie" IS NOT NEW."date_sortie" OR OLD."nb_nuits" IS NOT NEW."nb_nuits" OR OLD."nb_adultes" IS NOT NEW."nb_adultes" OR OLD."nb_enfants_2_17" IS NOT NEW."nb_enfants_2_17" OR OLD."prix_total" IS NOT NEW."prix_total" OR OLD."booking_source" IS NOT NEW."booking_source" OR OLD."payments_managed" IS NOT NEW."payments_managed" OR OLD."source_paiement" IS NOT NEW."source_paiement" OR OLD."remise_montant" IS NOT NEW."remise_montant" OR OLD."frais_optionnels_montant" IS NOT NEW."frais_optionnels_montant" OR OLD."options" IS NOT NEW."options" OR OLD."reporting_amounts" IS NOT NEW."reporting_amounts" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservations_delete" AFTER DELETE ON "reservations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_contrats_insert" AFTER INSERT ON "contrats"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_contrats_update" AFTER UPDATE OF "id", "reservation_id", "date_creation", "arrhes_montant", "solde_montant", "statut_paiement_arrhes", "date_paiement_arrhes", "statut_paiement_solde", "mode_paiement_arrhes", "organization_id" ON "contrats" WHEN (OLD."id" IS NOT NEW."id" OR OLD."reservation_id" IS NOT NEW."reservation_id" OR OLD."date_creation" IS NOT NEW."date_creation" OR OLD."arrhes_montant" IS NOT NEW."arrhes_montant" OR OLD."solde_montant" IS NOT NEW."solde_montant" OR OLD."statut_paiement_arrhes" IS NOT NEW."statut_paiement_arrhes" OR OLD."date_paiement_arrhes" IS NOT NEW."date_paiement_arrhes" OR OLD."statut_paiement_solde" IS NOT NEW."statut_paiement_solde" OR OLD."mode_paiement_arrhes" IS NOT NEW."mode_paiement_arrhes" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_contrats_delete" AFTER DELETE ON "contrats"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_booking_requests_insert" AFTER INSERT ON "booking_requests"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_booking_requests_update" AFTER UPDATE OF "id", "approved_reservation_id", "options", "pricing_snapshot", "status", "organization_id" ON "booking_requests" WHEN (OLD."id" IS NOT NEW."id" OR OLD."approved_reservation_id" IS NOT NEW."approved_reservation_id" OR OLD."options" IS NOT NEW."options" OR OLD."pricing_snapshot" IS NOT NEW."pricing_snapshot" OR OLD."status" IS NOT NEW."status" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_booking_requests_delete" AFTER DELETE ON "booking_requests"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_booking_payments_insert" AFTER INSERT ON "booking_payments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_booking_payments_update" AFTER UPDATE OF "id", "reservation_id", "booking_request_id", "payment_link_id", "stripe_mode", "purpose", "paid_amount_cents", "refunded_amount_cents", "total_cents", "status", "paid_at", "organization_id" ON "booking_payments" WHEN (OLD."id" IS NOT NEW."id" OR OLD."reservation_id" IS NOT NEW."reservation_id" OR OLD."booking_request_id" IS NOT NEW."booking_request_id" OR OLD."payment_link_id" IS NOT NEW."payment_link_id" OR OLD."stripe_mode" IS NOT NEW."stripe_mode" OR OLD."purpose" IS NOT NEW."purpose" OR OLD."paid_amount_cents" IS NOT NEW."paid_amount_cents" OR OLD."refunded_amount_cents" IS NOT NEW."refunded_amount_cents" OR OLD."total_cents" IS NOT NEW."total_cents" OR OLD."status" IS NOT NEW."status" OR OLD."paid_at" IS NOT NEW."paid_at" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_booking_payments_delete" AFTER DELETE ON "booking_payments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_payment_links_insert" AFTER INSERT ON "reservation_payment_links"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_payment_links_update" AFTER UPDATE OF "id", "reservation_id", "deposit_cents", "offline_received_cents", "terms_json", "organization_id" ON "reservation_payment_links" WHEN (OLD."id" IS NOT NEW."id" OR OLD."reservation_id" IS NOT NEW."reservation_id" OR OLD."deposit_cents" IS NOT NEW."deposit_cents" OR OLD."offline_received_cents" IS NOT NEW."offline_received_cents" OR OLD."terms_json" IS NOT NEW."terms_json" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_payment_links_delete" AFTER DELETE ON "reservation_payment_links"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_recorded_payments_insert" AFTER INSERT ON "reservation_recorded_payments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_recorded_payments_update" AFTER UPDATE OF "id", "reservation_id", "amount_cents", "method", "purpose", "paid_on", "note", "origin", "ota_details", "voided_at", "organization_id" ON "reservation_recorded_payments" WHEN (OLD."id" IS NOT NEW."id" OR OLD."reservation_id" IS NOT NEW."reservation_id" OR OLD."amount_cents" IS NOT NEW."amount_cents" OR OLD."method" IS NOT NEW."method" OR OLD."purpose" IS NOT NEW."purpose" OR OLD."paid_on" IS NOT NEW."paid_on" OR OLD."note" IS NOT NEW."note" OR OLD."origin" IS NOT NEW."origin" OR OLD."ota_details" IS NOT NEW."ota_details" OR OLD."voided_at" IS NOT NEW."voided_at" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_reservation_recorded_payments_delete" AFTER DELETE ON "reservation_recorded_payments"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_organization_runtime_settings_insert" AFTER INSERT ON "organization_runtime_settings" WHEN NEW."key" = 'reservation-payments'
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_organization_runtime_settings_update" AFTER UPDATE OF "id", "key", "value_json", "organization_id" ON "organization_runtime_settings" WHEN (OLD."id" IS NOT NEW."id" OR OLD."key" IS NOT NEW."key" OR OLD."value_json" IS NOT NEW."value_json" OR OLD."organization_id" IS NOT NEW."organization_id") AND (NEW."key" = 'reservation-payments' OR OLD."key" = 'reservation-payments')
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_organization_runtime_settings_delete" AFTER DELETE ON "organization_runtime_settings" WHEN OLD."key" = 'reservation-payments'
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_finance_report_stores_insert" AFTER INSERT ON "finance_report_stores"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_finance_report_stores_update" AFTER UPDATE OF "id", "revision", "data_json", "organization_id" ON "finance_report_stores" WHEN (OLD."id" IS NOT NEW."id" OR OLD."revision" IS NOT NEW."revision" OR OLD."data_json" IS NOT NEW."data_json" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_finance_report_stores_delete" AFTER DELETE ON "finance_report_stores"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_urssaf_declarations_insert" AFTER INSERT ON "urssaf_declarations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_urssaf_declarations_update" AFTER UPDATE OF "id", "year", "month", "gestionnaire_id", "amount", "declared_at", "organization_id" ON "urssaf_declarations" WHEN (OLD."id" IS NOT NEW."id" OR OLD."year" IS NOT NEW."year" OR OLD."month" IS NOT NEW."month" OR OLD."gestionnaire_id" IS NOT NEW."gestionnaire_id" OR OLD."amount" IS NOT NEW."amount" OR OLD."declared_at" IS NOT NEW."declared_at" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_urssaf_declarations_delete" AFTER DELETE ON "urssaf_declarations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

CREATE TRIGGER "report_cache_guest_night_declarations_insert" AFTER INSERT ON "guest_night_declarations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
END;

CREATE TRIGGER "report_cache_guest_night_declarations_update" AFTER UPDATE OF "id", "year", "month", "gite_id", "guest_nights", "declared_at", "organization_id" ON "guest_night_declarations" WHEN (OLD."id" IS NOT NEW."id" OR OLD."year" IS NOT NEW."year" OR OLD."month" IS NOT NEW."month" OR OLD."gite_id" IS NOT NEW."gite_id" OR OLD."guest_nights" IS NOT NEW."guest_nights" OR OLD."declared_at" IS NOT NEW."declared_at" OR OLD."organization_id" IS NOT NEW."organization_id")
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = NEW."organization_id";
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id" AND OLD."organization_id" IS NOT NEW."organization_id";
END;

CREATE TRIGGER "report_cache_guest_night_declarations_delete" AFTER DELETE ON "guest_night_declarations"
BEGIN
  UPDATE "finance_report_caches" SET "source_revision" = "source_revision" + 1 WHERE "organization_id" = OLD."organization_id";
END;

