-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "nom" TEXT NOT NULL,
    "prefixe_contrat" TEXT NOT NULL,
    "adresse_ligne1" TEXT NOT NULL,
    "adresse_ligne2" TEXT,
    "capacite_max" INTEGER NOT NULL,
    "nb_adultes_habituel" INTEGER NOT NULL DEFAULT 1,
    "proprietaires_noms" TEXT NOT NULL,
    "proprietaires_adresse" TEXT NOT NULL,
    "site_web" TEXT,
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
    "prix_nuit_liste" TEXT,
    "caracteristiques" TEXT,
    "airbnb_listing_id" TEXT,
    "ical_export_token" TEXT,
    "gestionnaire_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gites_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_gites" ("adresse_ligne1", "adresse_ligne2", "arrhes_taux_defaut", "bic", "capacite_max", "caracteristiques", "airbnb_listing_id", "caution_montant_defaut", "cheque_menage_montant_defaut", "createdAt", "email", "gestionnaire_id", "heure_arrivee_defaut", "heure_depart_defaut", "iban", "ical_export_token", "id", "nb_adultes_habituel", "nom", "options_chiens_forfait", "options_depart_tardif_forfait", "options_draps_par_lit", "options_linge_toilette_par_personne", "options_menage_forfait", "ordre", "prefixe_contrat", "prix_nuit_liste", "proprietaires_adresse", "proprietaires_noms", "regle_animaux_acceptes", "regle_bois_premiere_flambee", "regle_tiers_personnes_info", "site_web", "taxe_sejour_par_personne_par_nuit", "telephones", "titulaire", "updatedAt") SELECT "adresse_ligne1", "adresse_ligne2", "arrhes_taux_defaut", "bic", "capacite_max", "caracteristiques", "airbnb_listing_id", "caution_montant_defaut", "cheque_menage_montant_defaut", "createdAt", "email", "gestionnaire_id", "heure_arrivee_defaut", "heure_depart_defaut", "iban", "ical_export_token", "id", "nb_adultes_habituel", "nom", "options_chiens_forfait", "options_depart_tardif_forfait", "options_draps_par_lit", "options_linge_toilette_par_personne", "options_menage_forfait", "ordre", "prefixe_contrat", "prix_nuit_liste", "proprietaires_adresse", "proprietaires_noms", "regle_animaux_acceptes", "regle_bois_premiere_flambee", "regle_tiers_personnes_info", "site_web", "taxe_sejour_par_personne_par_nuit", "telephones", "titulaire", "updatedAt" FROM "gites";
DROP TABLE "gites";
ALTER TABLE "new_gites" RENAME TO "gites";
CREATE INDEX "gites_gestionnaire_id_idx" ON "gites"("gestionnaire_id");
CREATE INDEX "gites_ical_export_token_idx" ON "gites"("ical_export_token");
CREATE INDEX "gites_ordre_idx" ON "gites"("ordre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
