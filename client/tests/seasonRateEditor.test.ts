import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomaticSeasonRateSegments,
  buildDefaultSeasonRateEditorRange,
  buildFrenchBridgeIntervals,
  buildHolidayIntervals,
  buildPrefilledSeasonRateSegments,
  buildSeasonRateEditorSegments,
  buildSeasonRatePrefillDraft,
} from "../src/utils/seasonRateEditor.ts";

const holidays = [
  {
    zone: "B",
    start: "2026-02-07",
    end: "2026-02-21",
    description: "Vacances d'hiver",
    anneeScolaire: "2025-2026",
    population: "",
  },
];

test("buildDefaultSeasonRateEditorRange couvre toute l'année suivante", () => {
  assert.deepEqual(buildDefaultSeasonRateEditorRange(new Date("2026-05-13T12:00:00.000Z")), {
    from: "2026-05-01",
    to: "2028-01-01",
  });
});

test("buildHolidayIntervals convertit la fin inclusive en borne exclusive", () => {
  assert.deepEqual(buildHolidayIntervals(holidays, "2026-02-01", "2026-03-01"), [
    { start: "2026-02-07", end: "2026-02-22", names: ["Vacances d'hiver"] },
  ]);
});

test("buildHolidayIntervals ignore les ponts remontés comme vacances scolaires", () => {
  assert.deepEqual(
    buildHolidayIntervals(
      [
        {
          zone: "B",
          start: "2026-05-13",
          end: "2026-05-17",
          description: "Pont de l'Ascension",
          anneeScolaire: "2025-2026",
          population: "",
        },
      ],
      "2026-05-01",
      "2026-06-01"
    ),
    []
  );
});

test("buildSeasonRateEditorSegments segmente sur les bornes vacances et remonte les min nuits mixtes", () => {
  const segments = buildSeasonRateEditorSegments({
    from: "2026-02-01",
    to: "2026-03-01",
    holidays,
    gites: [
      { id: "g1", nom: "Tante Phonsine", ordre: 0, prefixe_contrat: "TP", prix_nuit_liste: [70, 75] },
      { id: "g2", nom: "La Grée", ordre: 1, prefixe_contrat: "LG", prix_nuit_liste: [70, 75] },
    ],
    rates_by_gite: {
      g1: [
        {
          id: "r1",
          gite_id: "g1",
          date_debut: "2026-02-01T00:00:00.000Z",
          date_fin: "2026-02-10T00:00:00.000Z",
          prix_par_nuit: 70,
          min_nuits: 2,
          ordre: 0,
        },
        {
          id: "r2",
          gite_id: "g1",
          date_debut: "2026-02-10T00:00:00.000Z",
          date_fin: "2026-03-01T00:00:00.000Z",
          prix_par_nuit: 90,
          min_nuits: 2,
          ordre: 1,
        },
      ],
      g2: [
        {
          id: "r3",
          gite_id: "g2",
          date_debut: "2026-02-01T00:00:00.000Z",
          date_fin: "2026-02-15T00:00:00.000Z",
          prix_par_nuit: 72,
          min_nuits: 3,
          ordre: 0,
        },
        {
          id: "r4",
          gite_id: "g2",
          date_debut: "2026-02-15T00:00:00.000Z",
          date_fin: "2026-03-01T00:00:00.000Z",
          prix_par_nuit: 92,
          min_nuits: 3,
          ordre: 1,
        },
      ],
    },
  });

  assert.deepEqual(
    segments.map((segment) => ({
      start: segment.date_debut,
      end: segment.date_fin,
      status: segment.holiday_status,
      holiday_names: segment.holiday_names,
      min_nuits: segment.min_nuits,
      mixed: segment.has_mixed_min_nights,
    })),
    [
      { start: "2026-02-01", end: "2026-02-07", status: "non_holiday", holiday_names: [], min_nuits: null, mixed: true },
      { start: "2026-02-07", end: "2026-02-10", status: "holiday", holiday_names: ["Vacances d'hiver"], min_nuits: null, mixed: true },
      { start: "2026-02-10", end: "2026-02-15", status: "holiday", holiday_names: ["Vacances d'hiver"], min_nuits: null, mixed: true },
      { start: "2026-02-15", end: "2026-02-22", status: "holiday", holiday_names: ["Vacances d'hiver"], min_nuits: null, mixed: true },
      { start: "2026-02-22", end: "2026-03-01", status: "non_holiday", holiday_names: [], min_nuits: null, mixed: true },
    ]
  );
  assert.equal(segments[2]?.prices_by_gite.g1, 90);
  assert.equal(segments[2]?.prices_by_gite.g2, 72);
});

test("buildPrefilledSeasonRateSegments applique tarif haut en vacances et bas hors vacances", () => {
  const segments = buildPrefilledSeasonRateSegments({
    from: "2026-02-01",
    to: "2026-03-01",
    holidays,
    gites: [{ id: "g1" }, { id: "g2" }],
    pricesByGite: {
      g1: { low: 70, high: 75 },
      g2: { low: 80, high: 95 },
    },
    minNuits: 4,
  });

  assert.deepEqual(
    segments.map((segment) => ({
      start: segment.date_debut,
      end: segment.date_fin,
      status: segment.holiday_status,
      holiday_names: segment.holiday_names,
      g1: segment.prices_by_gite.g1,
      g2: segment.prices_by_gite.g2,
      min: segment.min_nuits,
    })),
    [
      { start: "2026-02-01", end: "2026-02-07", status: "non_holiday", holiday_names: [], g1: 70, g2: 80, min: 4 },
      { start: "2026-02-07", end: "2026-02-22", status: "holiday", holiday_names: ["Vacances d'hiver"], g1: 75, g2: 95, min: 4 },
      { start: "2026-02-22", end: "2026-03-01", status: "non_holiday", holiday_names: [], g1: 70, g2: 80, min: 4 },
    ]
  );
});

test("buildSeasonRatePrefillDraft demande confirmation quand les suggestions sont incomplètes", () => {
  const result = buildSeasonRatePrefillDraft([
    { id: "g1", prix_nuit_liste: [70, 75] },
    { id: "g2", prix_nuit_liste: [90] },
    { id: "g3", prix_nuit_liste: [] },
  ]);

  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.draft, {
    g1: { low: "70", high: "75" },
    g2: { low: "90", high: "90" },
    g3: { low: "", high: "" },
  });
});

test("buildFrenchBridgeIntervals détecte les longs week-ends des fériés", () => {
  const bridges = buildFrenchBridgeIntervals("2026-05-01", "2026-06-01");

  assert.deepEqual(
    bridges.map((bridge) => ({ start: bridge.start, end: bridge.end, names: bridge.names })),
    [
      { start: "2026-05-01", end: "2026-05-04", names: ["Pont Fête du Travail"] },
      { start: "2026-05-08", end: "2026-05-11", names: ["Pont Victoire 1945"] },
      { start: "2026-05-14", end: "2026-05-17", names: ["Pont Ascension"] },
      { start: "2026-05-22", end: "2026-05-25", names: ["Pont Lundi de Pentecôte"] },
    ]
  );
});

test("buildAutomaticSeasonRateSegments ne découpe pas le pont de l'Ascension scolaire autour du pont férié", () => {
  const segments = buildAutomaticSeasonRateSegments({
    from: "2026-05-13",
    to: "2026-05-18",
    holidays: [
      {
        zone: "B",
        start: "2026-05-13",
        end: "2026-05-17",
        description: "Pont de l'Ascension",
        anneeScolaire: "2025-2026",
        population: "",
      },
    ],
    gites: [
      {
        id: "g1",
        prix_nuit_liste: [],
        prix_nuit_basse_saison: 70,
        prix_nuit_haute_saison: 90,
        min_nuits_toute_annee: 2,
        min_nuits_vacances_scolaires: 2,
        min_nuits_juillet_aout: 4,
      },
    ],
  });

  assert.deepEqual(
    segments.map((segment) => ({
      start: segment.date_debut,
      end: segment.date_fin,
      rule: segment.rule,
      names: segment.rule_names,
      min: segment.min_nuits,
    })),
    [
      { start: "2026-05-13", end: "2026-05-14", rule: "normal", names: [], min: 2 },
      { start: "2026-05-14", end: "2026-05-17", rule: "bridge", names: ["Pont Ascension"], min: 3 },
      { start: "2026-05-17", end: "2026-05-18", rule: "normal", names: [], min: 2 },
    ]
  );
});

test("buildAutomaticSeasonRateSegments classe un pont couvert par des vacances en vacances scolaires", () => {
  const segments = buildAutomaticSeasonRateSegments({
    from: "2026-12-24",
    to: "2026-12-31",
    holidays: [
      {
        zone: "B",
        start: "2026-12-19",
        end: "2027-01-04",
        description: "Vacances de Noël",
        anneeScolaire: "2026-2027",
        population: "",
      },
    ],
    gites: [
      {
        id: "g1",
        prix_nuit_liste: [],
        prix_nuit_basse_saison: 70,
        prix_nuit_haute_saison: 90,
        min_nuits_toute_annee: 2,
        min_nuits_vacances_scolaires: 4,
        min_nuits_juillet_aout: 5,
      },
    ],
  });

  assert.deepEqual(
    segments.map((segment) => ({
      start: segment.date_debut,
      end: segment.date_fin,
      rule: segment.rule,
      names: segment.rule_names,
      min: segment.min_nuits,
    })),
    [{ start: "2026-12-24", end: "2026-12-31", rule: "school_holiday", names: ["Vacances de Noël"], min: 4 }]
  );
});

test("buildAutomaticSeasonRateSegments applique les règles simples par gîte", () => {
  const segments = buildAutomaticSeasonRateSegments({
    from: "2026-06-28",
    to: "2026-09-03",
    holidays: [],
    gites: [
      {
        id: "g1",
        prix_nuit_liste: [],
        prix_nuit_basse_saison: 70,
        prix_nuit_haute_saison: 90,
        min_nuits_toute_annee: 2,
        min_nuits_vacances_scolaires: 2,
        min_nuits_juillet_aout: 4,
      },
      {
        id: "g2",
        prix_nuit_liste: [],
        prix_nuit_basse_saison: 80,
        prix_nuit_haute_saison: 110,
        min_nuits_toute_annee: 2,
        min_nuits_vacances_scolaires: 2,
        min_nuits_juillet_aout: 5,
      },
    ],
  });
  const summer = segments.find((segment) => segment.rule === "july_august");

  assert.ok(summer);
  assert.equal(summer.date_debut, "2026-07-01");
  assert.equal(summer.date_fin, "2026-09-01");
  assert.equal(summer.prices_by_gite.g1, 90);
  assert.equal(summer.prices_by_gite.g2, 110);
  assert.equal(summer.min_nuits_by_gite.g1, 4);
  assert.equal(summer.min_nuits_by_gite.g2, 5);
  assert.equal(summer.min_nuits, null);
  assert.equal(summer.has_mixed_min_nights, true);
});
