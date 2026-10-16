-- CreateTable
CREATE TABLE "fiscal_entities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "gestionnaire_id" TEXT,
    "legal_name" TEXT NOT NULL,
    "siren" TEXT,
    "vat_number" TEXT,
    "vat_regime" TEXT NOT NULL DEFAULT 'unknown',
    "address_line1" TEXT,
    "address_line2" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'FR',
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fiscal_entities_gestionnaire_id_organization_id_fkey" FOREIGN KEY ("gestionnaire_id", "organization_id") REFERENCES "gestionnaires" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fiscal_establishments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "fiscal_entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'FR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fiscal_establishments_fiscal_entity_id_organization_id_fkey" FOREIGN KEY ("fiscal_entity_id", "organization_id") REFERENCES "fiscal_entities" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "nom" TEXT NOT NULL,
    "nom_avec_preposition" TEXT,
    "prefixe_contrat" TEXT NOT NULL,
    "adresse_ligne1" TEXT NOT NULL,
    "adresse_ligne2" TEXT,
    "capacite_max" INTEGER NOT NULL,
    "nb_adultes_max" INTEGER NOT NULL DEFAULT 1,
    "nb_adultes_habituel" INTEGER NOT NULL DEFAULT 1,
    "nb_enfants_max" INTEGER NOT NULL DEFAULT 0,
    "proprietaires_noms" TEXT NOT NULL,
    "proprietaires_adresse" TEXT NOT NULL,
    "site_web" TEXT,
    "public_slug" TEXT,
    "public_translations" TEXT,
    "public_title" TEXT,
    "public_summary" TEXT,
    "public_description" TEXT,
    "public_technical_description" TEXT,
    "public_seo_title" TEXT,
    "public_seo_description" TEXT,
    "public_is_published" BOOLEAN NOT NULL DEFAULT false,
    "public_structured_content" TEXT,
    "public_equipment" TEXT,
    "public_rooms" TEXT,
    "public_practical_info" TEXT,
    "public_location_info" TEXT,
    "public_web_info" TEXT,
    "public_latitude" REAL,
    "public_longitude" REAL,
    "email" TEXT,
    "telephones" TEXT NOT NULL,
    "taxe_sejour_par_personne_par_nuit" REAL NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "titulaire" TEXT NOT NULL,
    "regle_animaux_acceptes" BOOLEAN NOT NULL DEFAULT false,
    "regle_bois_premiere_flambee" BOOLEAN NOT NULL DEFAULT false,
    "regle_tiers_personnes_info" BOOLEAN NOT NULL DEFAULT false,
    "options_draps_par_lit" REAL NOT NULL DEFAULT 0,
    "options_linge_toilette_par_personne" REAL NOT NULL DEFAULT 0,
    "options_menage_forfait" REAL NOT NULL DEFAULT 0,
    "options_depart_tardif_forfait" REAL NOT NULL DEFAULT 0,
    "options_chiens_forfait" REAL NOT NULL DEFAULT 0,
    "heure_arrivee_defaut" TEXT NOT NULL DEFAULT '17:00',
    "heure_depart_defaut" TEXT NOT NULL DEFAULT '12:00',
    "caution_montant_defaut" REAL NOT NULL DEFAULT 0,
    "cheque_menage_montant_defaut" REAL NOT NULL DEFAULT 0,
    "arrhes_taux_defaut" REAL NOT NULL DEFAULT 0.2,
    "electricity_price_per_kwh" REAL NOT NULL DEFAULT 0,
    "prix_intervention" REAL NOT NULL DEFAULT 0,
    "frais_gestion" TEXT,
    "prix_nuit_basse_saison" REAL NOT NULL DEFAULT 0,
    "prix_nuit_haute_saison" REAL NOT NULL DEFAULT 0,
    "min_nuits_toute_annee" INTEGER NOT NULL DEFAULT 1,
    "min_nuits_vacances_scolaires" INTEGER NOT NULL DEFAULT 1,
    "min_nuits_juillet_aout" INTEGER NOT NULL DEFAULT 1,
    "prix_nuit_liste" TEXT,
    "caracteristiques" TEXT,
    "airbnb_listing_id" TEXT,
    "ical_export_token" TEXT,
    "gestionnaire_id" TEXT,
    "fiscal_establishment_id" TEXT,
    "date_debut_activite" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    CONSTRAINT "gites_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "gites_fiscal_establishment_id_organization_id_fkey" FOREIGN KEY ("fiscal_establishment_id", "organization_id") REFERENCES "fiscal_establishments" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_gites" ("adresse_ligne1", "adresse_ligne2", "airbnb_listing_id", "arrhes_taux_defaut", "bic", "capacite_max", "caracteristiques", "caution_montant_defaut", "cheque_menage_montant_defaut", "createdAt", "date_debut_activite", "electricity_price_per_kwh", "email", "frais_gestion", "gestionnaire_id", "heure_arrivee_defaut", "heure_depart_defaut", "iban", "ical_export_token", "id", "min_nuits_juillet_aout", "min_nuits_toute_annee", "min_nuits_vacances_scolaires", "nb_adultes_habituel", "nb_adultes_max", "nb_enfants_max", "nom", "nom_avec_preposition", "options_chiens_forfait", "options_depart_tardif_forfait", "options_draps_par_lit", "options_linge_toilette_par_personne", "options_menage_forfait", "ordre", "organization_id", "prefixe_contrat", "prix_intervention", "prix_nuit_basse_saison", "prix_nuit_haute_saison", "prix_nuit_liste", "proprietaires_adresse", "proprietaires_noms", "public_description", "public_equipment", "public_is_published", "public_latitude", "public_location_info", "public_longitude", "public_practical_info", "public_rooms", "public_seo_description", "public_seo_title", "public_slug", "public_structured_content", "public_summary", "public_technical_description", "public_title", "public_translations", "public_web_info", "regle_animaux_acceptes", "regle_bois_premiere_flambee", "regle_tiers_personnes_info", "site_web", "taxe_sejour_par_personne_par_nuit", "telephones", "titulaire", "updatedAt") SELECT "adresse_ligne1", "adresse_ligne2", "airbnb_listing_id", "arrhes_taux_defaut", "bic", "capacite_max", "caracteristiques", "caution_montant_defaut", "cheque_menage_montant_defaut", "createdAt", "date_debut_activite", "electricity_price_per_kwh", "email", "frais_gestion", "gestionnaire_id", "heure_arrivee_defaut", "heure_depart_defaut", "iban", "ical_export_token", "id", "min_nuits_juillet_aout", "min_nuits_toute_annee", "min_nuits_vacances_scolaires", "nb_adultes_habituel", "nb_adultes_max", "nb_enfants_max", "nom", "nom_avec_preposition", "options_chiens_forfait", "options_depart_tardif_forfait", "options_draps_par_lit", "options_linge_toilette_par_personne", "options_menage_forfait", "ordre", "organization_id", "prefixe_contrat", "prix_intervention", "prix_nuit_basse_saison", "prix_nuit_haute_saison", "prix_nuit_liste", "proprietaires_adresse", "proprietaires_noms", "public_description", "public_equipment", "public_is_published", "public_latitude", "public_location_info", "public_longitude", "public_practical_info", "public_rooms", "public_seo_description", "public_seo_title", "public_slug", "public_structured_content", "public_summary", "public_technical_description", "public_title", "public_translations", "public_web_info", "regle_animaux_acceptes", "regle_bois_premiere_flambee", "regle_tiers_personnes_info", "site_web", "taxe_sejour_par_personne_par_nuit", "telephones", "titulaire", "updatedAt" FROM "gites";
DROP TABLE "gites";
ALTER TABLE "new_gites" RENAME TO "gites";
CREATE INDEX "gites_gestionnaire_id_idx" ON "gites"("gestionnaire_id");
CREATE INDEX "gites_org_fiscal_establishment_idx" ON "gites"("organization_id", "fiscal_establishment_id");
CREATE INDEX "gites_ical_export_token_idx" ON "gites"("ical_export_token");
CREATE INDEX "gites_ordre_idx" ON "gites"("ordre");
CREATE INDEX "gites_public_published_ordre_idx" ON "gites"("public_is_published", "ordre");
CREATE UNIQUE INDEX "gites_org_public_slug_key" ON "gites"("organization_id", "public_slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "fiscal_entities_org_manager_idx" ON "fiscal_entities"("organization_id", "gestionnaire_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_entities_id_org_key" ON "fiscal_entities"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_entities_org_siren_key" ON "fiscal_entities"("organization_id", "siren");

-- CreateIndex
CREATE INDEX "fiscal_establishments_org_entity_idx" ON "fiscal_establishments"("organization_id", "fiscal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_establishments_id_org_key" ON "fiscal_establishments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_establishments_org_siret_key" ON "fiscal_establishments"("organization_id", "siret");

-- CreateIndex
CREATE UNIQUE INDEX "gestionnaires_id_org_key" ON "gestionnaires"("id", "organization_id");
