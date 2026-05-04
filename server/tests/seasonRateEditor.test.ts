import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeasonRateWritePlan,
  validateSeasonRateEditorPayload,
  type SeasonRateEditorPayload,
} from "../src/services/seasonRateEditor.ts";
import { BookedValidationError } from "../src/services/booked.ts";

const giteIds = ["g1", "g2", "g3", "g4"];

test("validateSeasonRateEditorPayload refuse un trou dans la couverture", () => {
  assert.throws(
    () =>
      validateSeasonRateEditorPayload(
        {
          from: "2026-05-01",
          to: "2026-05-10",
          zone: "B",
          segments: [
            {
              date_debut: "2026-05-01",
              date_fin: "2026-05-05",
              min_nuits: 2,
              prices_by_gite: { g1: 70, g2: 70, g3: 80, g4: 350 },
            },
            {
              date_debut: "2026-05-06",
              date_fin: "2026-05-10",
              min_nuits: 2,
              prices_by_gite: { g1: 70, g2: 70, g3: 80, g4: 350 },
            },
          ],
        },
        giteIds
      ),
    (error: unknown) =>
      error instanceof BookedValidationError &&
      error.code === "segments_not_contiguous" &&
      /sans trou ni chevauchement/i.test(error.message)
  );
});

test("validateSeasonRateEditorPayload refuse prix manquant et min nuits invalide", () => {
  assert.throws(
    () =>
      validateSeasonRateEditorPayload(
        {
          from: "2026-05-01",
          to: "2026-05-10",
          zone: "B",
          segments: [
            {
              date_debut: "2026-05-01",
              date_fin: "2026-05-10",
              min_nuits: 0,
              prices_by_gite: { g1: 70, g2: 70, g3: 80 },
            },
          ],
        } as unknown as SeasonRateEditorPayload,
        giteIds
      ),
    (error: unknown) => error instanceof BookedValidationError && error.code === "invalid_min_nights"
  );

  assert.throws(
    () =>
      validateSeasonRateEditorPayload(
        {
          from: "2026-05-01",
          to: "2026-05-10",
          zone: "B",
          segments: [
            {
              date_debut: "2026-05-01",
              date_fin: "2026-05-10",
              min_nuits: 2,
              prices_by_gite: { g1: 70, g2: 70, g3: 80 },
            },
          ],
        } as unknown as SeasonRateEditorPayload,
        giteIds
      ),
    (error: unknown) => error instanceof BookedValidationError && error.code === "missing_price"
  );
});

test("buildSeasonRateWritePlan préserve les morceaux hors plage et remplace la fenêtre éditée", () => {
  const plan = buildSeasonRateWritePlan({
    giteId: "g1",
    from: "2026-05-10",
    to: "2026-05-20",
    segments: [
      {
        date_debut: "2026-05-10",
        date_fin: "2026-05-15",
        min_nuits: 3,
        prices_by_gite: { g1: 80, g2: 81, g3: 82, g4: 83 },
      },
      {
        date_debut: "2026-05-15",
        date_fin: "2026-05-20",
        min_nuits: 4,
        prices_by_gite: { g1: 90, g2: 91, g3: 92, g4: 93 },
      },
    ],
    existingRates: [
      {
        id: "before-overlap",
        gite_id: "g1",
        date_debut: new Date("2026-05-01T00:00:00.000Z"),
        date_fin: new Date("2026-05-12T00:00:00.000Z"),
        prix_par_nuit: 70,
        min_nuits: 2,
        ordre: 0,
      },
      {
        id: "middle-overlap",
        gite_id: "g1",
        date_debut: new Date("2026-05-12T00:00:00.000Z"),
        date_fin: new Date("2026-05-18T00:00:00.000Z"),
        prix_par_nuit: 72,
        min_nuits: 2,
        ordre: 1,
      },
      {
        id: "after-overlap",
        gite_id: "g1",
        date_debut: new Date("2026-05-18T00:00:00.000Z"),
        date_fin: new Date("2026-05-25T00:00:00.000Z"),
        prix_par_nuit: 74,
        min_nuits: 2,
        ordre: 2,
      },
    ],
  });

  assert.deepEqual(plan.delete_ids, ["before-overlap", "middle-overlap", "after-overlap"]);
  assert.deepEqual(
    plan.create_rows.map((row) => ({
      date_debut: row.date_debut.toISOString().slice(0, 10),
      date_fin: row.date_fin.toISOString().slice(0, 10),
      prix_par_nuit: row.prix_par_nuit,
      min_nuits: row.min_nuits,
    })),
    [
      { date_debut: "2026-05-01", date_fin: "2026-05-10", prix_par_nuit: 70, min_nuits: 2 },
      { date_debut: "2026-05-10", date_fin: "2026-05-15", prix_par_nuit: 80, min_nuits: 3 },
      { date_debut: "2026-05-15", date_fin: "2026-05-20", prix_par_nuit: 90, min_nuits: 4 },
      { date_debut: "2026-05-20", date_fin: "2026-05-25", prix_par_nuit: 74, min_nuits: 2 },
    ]
  );
});
