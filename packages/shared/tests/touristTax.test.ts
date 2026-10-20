import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeTouristTax,
  createTouristTaxStay,
  touristTaxSettingsSchema,
  reservationAmountToCollect,
  reservationTouristTax,
  type TouristTaxSettings,
} from "../src/touristTax.js";
import {
  emptyInvoiceFiscalInput,
  computeInvoiceFiscal,
  invoiceFiscalIssues,
} from "../src/invoiceFiscal.js";
const policy = (
  patch: Partial<TouristTaxSettings> = {},
): TouristTaxSettings => ({
  version: 1,
  classified: true,
  stars: 3,
  included: false,
  fixed_rate: 1.5,
  percentage: 4,
  cap: 4,
  additional_percentage: 0,
  accommodation_vat_rate: 0,
  authority: "Collectivité fictive",
  effective_from: "2026-01-01",
  ...patch,
});
const calculate = (
  settings = policy(),
  collector: "host" | "platform" = "host",
) =>
  computeTouristTax({
    stay: {
      ...createTouristTaxStay(settings),
      collector,
      platform: collector === "platform" ? "Plateforme fictive" : "",
    },
    nights: 2,
    adults: 2,
    children: 0,
    accommodation: 350,
    start: "2026-10-20",
  });

test("gîte classé : la taxe s’ajoute au prix ou s’en extrait sans changer le prix annoncé", () => {
  const extra = calculate();
  assert.equal(extra.amount, 6);
  assert.equal(extra.host_amount, 6);
  assert.equal(extra.accommodation_amount, 350);
  assert.deepEqual(extra.issues, []);
  const included = calculate(policy({ included: true }));
  assert.equal(included.amount, 6);
  assert.equal(included.accommodation_amount, 344);
  assert.equal(included.accommodation_amount + included.host_amount, 350);
});

test("collecte plateforme : pas de double collecte, y compris avec un prix taxe comprise", () => {
  const tax = calculate(policy(), "platform");
  assert.equal(tax.amount, 6);
  assert.equal(tax.host_amount, 0);
  assert.equal(tax.accommodation_amount, 350);
  assert.equal(
    calculate(policy({ included: true }), "platform").accommodation_amount,
    344,
  );
});

test("non classé : tous les occupants entrent au diviseur, seuls les adultes non exonérés paient", () => {
  const tax = computeTouristTax({
    stay: {
      ...createTouristTaxStay(policy({ classified: false, stars: 0 })),
      collector: "host",
      infants: 1,
      exempt_adults: 1,
      exemption_reason: "Travail saisonnier",
    },
    nights: 2,
    adults: 2,
    children: 1,
    accommodation: 400,
  });
  assert.equal(tax.occupants, 4);
  assert.equal(tax.taxable_adults, 1);
  assert.equal(tax.exempt_people, 3);
  assert.equal(tax.unit_amount, 2);
  assert.equal(tax.amount, 4);
});

test("le prix HT, le plafond et les taxes additionnelles sont appliqués avant la multiplication", () => {
  const tax = computeTouristTax({
    stay: {
      ...createTouristTaxStay(
        policy({
          classified: false,
          stars: 0,
          accommodation_vat_rate: 10,
          cap: 2,
          additional_percentage: 10,
        }),
      ),
      collector: "host",
    },
    nights: 1,
    adults: 2,
    children: 0,
    accommodation: 220,
  });
  assert.equal(tax.unit_amount, 2.2);
  assert.equal(tax.amount, 4.4);
  const uncapped = computeTouristTax({
    stay: {
      ...createTouristTaxStay(
        policy({ classified: false, stars: 0, accommodation_vat_rate: 10 }),
      ),
      collector: "host",
    },
    nights: 1,
    adults: 2,
    children: 0,
    accommodation: 110,
  });
  assert.equal(uncapped.unit_amount, 2);
});

test("un prix proportionnel taxe comprise reste exact au centime, sans modifier le montant annoncé", () => {
  for (const price of [100, 100.01, 350, 399.99, 1000]) {
    const tax = computeTouristTax({
      stay: {
        ...createTouristTaxStay(
          policy({
            classified: false,
            stars: 0,
            included: true,
            additional_percentage: 10,
          }),
        ),
        collector: "host",
      },
      nights: 3,
      adults: 2,
      children: 1,
      accommodation: price,
    });
    assert.equal(
      Math.round((tax.accommodation_amount + tax.host_amount) * 100),
      Math.round(price * 100),
    );
    assert.equal(
      Math.round(tax.amount * 100),
      Math.round(tax.unit_amount * 100) * 6,
    );
  }
});

test("collecteur inconnu, plateforme manquante, barème futur et exonération sans motif restent explicites", () => {
  const stay = createTouristTaxStay(policy());
  assert.ok(
    computeTouristTax({
      stay,
      nights: 1,
      adults: 1,
      children: 0,
      accommodation: 100,
    }).issues.some((issue) => issue.includes("qui collecte")),
  );
  const tax = computeTouristTax({
    stay: { ...stay, collector: "not_applicable" },
    nights: 1,
    adults: 1,
    children: 0,
    accommodation: 100,
    start: "2025-12-31",
  });
  assert.equal(tax.amount, 0);
  assert.ok(tax.issues.some((issue) => issue.includes("motif")));
  assert.ok(tax.issues.some((issue) => issue.includes("avant la date")));
  assert.ok(calculate(policy(), "platform").issues.length === 0);
});

test("la configuration impose un vrai classement ou un barème proportionnel renseigné", () => {
  assert.equal(
    touristTaxSettingsSchema.safeParse(policy({ stars: 0 })).success,
    false,
  );
  assert.equal(
    touristTaxSettingsSchema.safeParse(
      policy({ classified: false, percentage: 0 }),
    ).success,
    false,
  );
  assert.equal(
    touristTaxSettingsSchema.safeParse(policy({ effective_from: "2026-99-99" }))
      .success,
    false,
  );
});

test("les réservations historiques restent inchangées et le barème enregistré reste figé", () => {
  const reservation = {
    nb_nuits: 2,
    nb_adultes: 2,
    prix_total: 350,
    remise_montant: 10,
    frais_optionnels_montant: 20,
    options: {},
  };
  assert.equal(reservationAmountToCollect(reservation), 360);
  assert.equal(reservationTouristTax(reservation), null);
  const settings = policy({ included: true });
  const recorded = {
    ...reservation,
    options: {
      tourist_tax: {
        ...createTouristTaxStay(structuredClone(settings)),
        collector: "host" as const,
      },
    },
  };
  settings.fixed_rate = 99;
  assert.equal(reservationAmountToCollect(recorded), 360);
  assert.equal(reservationTouristTax(recorded)?.amount, 6);
});

test("la taxe collectée ne porte pas de TVA et son total doit correspondre au calcul enregistré", () => {
  const input = emptyInvoiceFiscalInput();
  input.lines = [
    {
      id: "1",
      label: "Hébergement",
      quantity: 1,
      unit: "C62",
      unit_price_ttc: 110,
      vat_category: "S",
      vat_rate: 10,
      exemption_reason: "",
    },
  ];
  input.tourist_taxes = [calculate()];
  input.paid_amount = 20;
  const totals = computeInvoiceFiscal(input);
  assert.equal(totals.net_cents, 10000);
  assert.equal(totals.vat_cents, 1000);
  assert.equal(totals.tourist_tax_cents, 600);
  assert.equal(totals.gross_cents, 11600);
  assert.equal(totals.due_cents, 9600);
  assert.equal(totals.rounding_cents, 0);
  assert.ok(
    !invoiceFiscalIssues(input, 116, {
      touristTaxes: input.tourist_taxes,
    }).some((issue) => issue.includes("ne correspond pas")),
  );
  assert.ok(
    invoiceFiscalIssues(input, 116).some((issue) =>
      issue.includes("ne correspond pas"),
    ),
  );
});

test("un prix inclus sans solution au centime reste à corriger avant émission", () => {
  const tax = computeTouristTax({
    stay: {
      ...createTouristTaxStay(
        policy({
          classified: false,
          stars: 0,
          included: true,
          additional_percentage: 10,
        }),
      ),
      collector: "host",
    },
    nights: 3,
    adults: 2,
    children: 1,
    accommodation: 10.42,
  });
  assert.ok(tax.issues.some((issue) => issue.includes("ventilation exacte")));
});
