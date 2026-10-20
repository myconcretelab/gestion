import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsPayload, type StatisticsGite, type StatisticsReservation } from "../src/services/statistics.js";

const gite: StatisticsGite = {
  id: "gite-1",
  nom: "Gîte test",
  ordre: 1,
  prefixe_contrat: "GT",
  proprietaires_noms: "Propriétaire",
  gestionnaire_id: null,
  date_debut_activite: new Date("2024-01-01T00:00:00.000Z"),
  gestionnaire: null,
};

const reservation: StatisticsReservation = {
  id: "reservation-1",
  gite_id: gite.id,
  date_entree: new Date("2025-12-30T00:00:00.000Z"),
  date_sortie: new Date("2026-01-03T00:00:00.000Z"),
  nb_nuits: 4,
  nb_adultes: 2,
  prix_par_nuit: 100,
  prix_total: 400,
  source_paiement: "Virement",
  frais_optionnels_montant: 0,
  frais_optionnels_declares: false,
};

test("buildStatisticsPayload ne renvoie que les segments de l'année demandée", () => {
  const payload = buildStatisticsPayload({
    gites: [gite],
    reservations: [reservation],
    selectedYear: 2026,
    availableYears: [2026, 2025, 2024],
  });

  assert.deepEqual(payload.availableYears, [2026, 2025, 2024]);
  assert.equal(payload.entriesByGite[gite.id].length, 1);
  assert.equal(payload.entriesByGite[gite.id][0].debut, "2026-01-01");
});


test("la taxe comprise dans le prix est isolée des revenus, avec les centimes conservés entre mois", () => {
  const options = { tourist_tax: { settings: { version: 1 as const, classified: true, stars: 3, included: true, fixed_rate: 1.5, percentage: 4, cap: 4, additional_percentage: 0, accommodation_vat_rate: 0, authority: "", effective_from: "2025-01-01" }, collector: "host" as const, platform: "", infants: 0, exempt_adults: 0, exemption_reason: "" } };
  const payload = buildStatisticsPayload({ gites: [gite], reservations: [{ ...reservation, prix_total: 400.01, options }] });
  assert.equal(Math.round(payload.entriesByGite[gite.id].reduce((sum, entry) => sum + entry.revenus, 0) * 100), 38801);
});
