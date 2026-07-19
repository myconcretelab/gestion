import assert from "node:assert/strict";
import test from "node:test";
import { parseLegacyRevenue2020Sheets } from "../src/services/legacyRevenueImport.ts";

const headers = [
  "Nom",
  "Debut",
  "Fin",
  "Mois",
  "Nb Nuits",
  "Nb Adultes",
  "PRix/nuits",
  "Revenus",
  "Paiement",
];

test("l'import historique reconstruit la sortie depuis le nombre de nuits et préserve le revenu", () => {
  const parsed = parseLegacyRevenue2020Sheets(
    [
      {
        sheet: "Test2020",
        data: [
          headers,
          [
            "Camille",
            new Date("2020-05-13T00:00:00.000Z"),
            new Date("2020-05-15T00:00:00.000Z"),
            "05",
            3,
            2,
            60,
            189,
            "Cheque",
          ],
        ],
      },
    ],
    [{ sheetName: "Test2020", giteName: "Le Test" }]
  );

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].departure.toISOString(), "2020-05-16T00:00:00.000Z");
  assert.equal(parsed.records[0].nightlyPrice, 63);
  assert.equal(parsed.records[0].paymentSource, "Chèque");
  assert.match(parsed.warnings[0], /sortie 2020-05-15 remplacée/);
});

test("l'import ignore les lignes à zéro nuit et signale les chevauchements", () => {
  const parsed = parseLegacyRevenue2020Sheets(
    [
      {
        sheet: "Test2020",
        data: [
          headers,
          [
            "Premier",
            new Date("2020-02-25T00:00:00.000Z"),
            new Date("2020-02-29T00:00:00.000Z"),
            "02",
            4,
            2,
            60,
            240,
            "Airbnb",
          ],
          [
            "Second",
            new Date("2020-02-28T00:00:00.000Z"),
            new Date("2020-03-01T00:00:00.000Z"),
            "02",
            2,
            2,
            30,
            60,
            "Airbnb",
          ],
          [
            "Vide",
            new Date("2020-04-01T00:00:00.000Z"),
            new Date("2020-04-02T00:00:00.000Z"),
            "04",
            0,
            2,
            0,
            0,
            "Airbnb",
          ],
        ],
      },
    ],
    [{ sheetName: "Test2020", giteName: "Le Test" }]
  );

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.skippedRows, 1);
  assert.ok(parsed.warnings.some((warning) => warning.includes("chevauchement")));
});
