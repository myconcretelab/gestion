import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLegacyRevenue2020Sheets,
  parseLegacyRevenueSheets,
} from "../src/services/legacyRevenueImport.ts";
import { resolveLegacyRevenueGite } from "../src/services/legacyRevenueDatabaseImport.ts";

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
const columns2020 = {
  guest: 0,
  arrival: 1,
  departure: 2,
  nights: 4,
  adults: 5,
  nightlyPrice: 6,
  revenue: 7,
  paymentSource: 8,
};

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
    [{ sheetName: "Test2020", giteName: "Le Test", columns: columns2020 }]
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
    [{ sheetName: "Test2020", giteName: "Le Test", columns: columns2020 }]
  );

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.skippedRows, 1);
  assert.ok(parsed.warnings.some((warning) => warning.includes("chevauchement")));
});

test("le format 2019 applique les valeurs par défaut absentes du classeur", () => {
  const parsed = parseLegacyRevenueSheets(
    [
      {
        sheet: "Gree",
        data: [
          ["Nom", "Debut", "Fin", "Mois", "Nb Nuits", "PRix/nuits", "Revenus"],
          [
            "",
            new Date("2019-01-02T00:00:00.000Z"),
            new Date("2019-01-05T00:00:00.000Z"),
            "01",
            3,
            60,
            180,
          ],
        ],
      },
    ],
    {
      year: 2019,
      sheets: [
        {
          sheetName: "Gree",
          giteName: "La Grée",
          columns: {
            guest: 0,
            arrival: 1,
            departure: 2,
            nights: 4,
            nightlyPrice: 5,
            revenue: 6,
          },
        },
      ],
    }
  );

  assert.equal(parsed.records[0].guestName, "Hôte non renseigné");
  assert.equal(parsed.records[0].adults, 2);
  assert.equal(parsed.records[0].paymentSource, "A définir");
  assert.equal(parsed.records[0].originReference, "revenus-2019:Gree:2");
});

test("l'import signale un total de feuille qui ne couvre pas toutes les lignes", () => {
  const columns = {
    guest: 0,
    arrival: 1,
    departure: 2,
    nights: 4,
    nightlyPrice: 5,
    revenue: 7,
  };
  const parsed = parseLegacyRevenueSheets(
    [
      {
        sheet: "Phonsine 2017",
        data: [
          [null, "Début", "Fin", "Mois", "Nb de nuits", "Prix/nuit", null, "Revenus"],
          ["Premier", new Date("2017-01-01"), new Date("2017-01-03"), "01", 2, 60, null, 120],
          ["Second", new Date("2017-01-03"), new Date("2017-01-04"), "01", 1, 60, null, 60],
          [null, null, null, null, 2, null, null, 120],
        ],
      },
    ],
    {
      year: 2017,
      sheets: [{ sheetName: "Phonsine 2017", giteName: "Tante Phonsine", columns }],
    }
  );

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.skippedRows, 0);
  assert.ok(parsed.warnings.some((warning) => warning.includes("2 nuits") && warning.includes("3 nuits")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("120.00 €") && warning.includes("180.00 €")));
});

test("le format 2018 accepte un séjour commencé fin décembre 2017", () => {
  const parsed = parseLegacyRevenueSheets(
    [
      {
        sheet: "Phonsine 2018",
        data: [
          ["SUMMARY", "DTSTART", "DTEND", "Mois", "Nb de nuits", "Prix/nuit", null, "Revenus"],
          [
            "Passage d'année",
            new Date("2017-12-31"),
            new Date("2018-01-02"),
            "01",
            2,
            63,
            null,
            126,
          ],
        ],
      },
    ],
    {
      year: 2018,
      allowPreviousYearArrival: true,
      sheets: [
        {
          sheetName: "Phonsine 2018",
          giteName: "Tante Phonsine",
          columns: {
            guest: 0,
            arrival: 1,
            departure: 2,
            nights: 4,
            nightlyPrice: 5,
            revenue: 7,
          },
        },
      ],
    }
  );

  assert.equal(parsed.records.length, 1);
  assert.match(parsed.warnings[0], /commencé en 2017/);
});

test("l'import retrouve un gîte dont le libellé contient le nom historique", () => {
  const candidates = [
    { id: "gree", nom: "La Grée", date_debut_activite: null },
    { id: "edmond", nom: "Gîte d'Edmond", date_debut_activite: null },
  ];

  assert.equal(resolveLegacyRevenueGite("Edmond", candidates)?.id, "edmond");
  assert.equal(resolveLegacyRevenueGite("La Grée", candidates)?.id, "gree");
});

test("l'import refuse une association de gîte ambiguë", () => {
  const candidates = [
    { id: "edmond-1", nom: "Petit Edmond", date_debut_activite: null },
    { id: "edmond-2", nom: "Grand Edmond", date_debut_activite: null },
  ];

  assert.equal(resolveLegacyRevenueGite("Edmond", candidates), null);
});

test("le format Airbnb 2015 reconstruit la sortie et le prix par nuit", () => {
  const parsed = parseLegacyRevenueSheets(
    [
      {
        sheet: "Phonsine 2015",
        data: [
          [
            "Date",
            "Type",
            "Code de confirmation",
            "Début",
            "Nuits",
            "Voyageur",
            "Logement",
            "Détails",
            "Référence",
            "Devise",
            "Montant",
          ],
          [
            new Date("2015-10-19"),
            "Réservation",
            "P2C885",
            new Date("2015-10-18"),
            7,
            "Nathalie Bigot",
            "Gîte de charme",
            null,
            null,
            "EUR",
            357,
          ],
        ],
      },
    ],
    {
      year: 2015,
      sheets: [
        {
          sheetName: "Phonsine 2015",
          giteName: "Tante Phonsine",
          defaultPaymentSource: "Airbnb",
          columns: {
            guest: 5,
            arrival: 3,
            nights: 4,
            revenue: 10,
          },
        },
      ],
    }
  );

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].departure.toISOString(), "2015-10-25T00:00:00.000Z");
  assert.equal(parsed.records[0].nightlyPrice, 51);
  assert.equal(parsed.records[0].revenue, 357);
  assert.equal(parsed.records[0].paymentSource, "Airbnb");
});
