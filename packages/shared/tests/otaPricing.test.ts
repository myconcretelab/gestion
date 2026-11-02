import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateOtaPrice, otaCommissionCents } from "../src/otaPricing.js";

const empty = {
  menage: 0,
  draps: 0,
  linge_toilette: 0,
  depart_tardif: 0,
  chiens: 0,
};
const rule = {
  percent: 10,
  rounding: "euro" as const,
  scope: "accommodation" as const,
};
test("les trois relevés Gîtes de France se retrouvent depuis le prix de location, le brut ou le net", () => {
  for (const [rental, cleaning, linen, fee, net] of [
    [175000, 12000, 13500, 17500, 183000],
    [52200, 0, 0, 5200, 47000],
    [60900, 0, 3000, 6100, 57800],
  ]) {
    const included = { ...empty, menage: cleaning, draps: linen };
    for (const basis of ["rental", "gross", "net"] as const) {
      const amountCents =
        basis === "rental"
          ? rental
          : basis === "gross"
            ? rental + cleaning + linen
            : net;
      const actual = calculateOtaPrice({ basis, amountCents, included }, rule);
      assert.deepEqual(
        [actual.grossCents, actual.feeCents, actual.netCents],
        [rental + cleaning + linen, fee, net],
      );
    }
  }
});
test("le choix de l'assiette, l'arrondi et la commission réelle sont indépendants", () => {
  const input = {
    basis: "gross" as const,
    amountCents: 63900,
    included: { ...empty, draps: 3000 },
  };
  assert.equal(calculateOtaPrice(input, rule).feeCents, 6100);
  assert.equal(
    calculateOtaPrice(input, { ...rule, scope: "all" }).feeCents,
    6400,
  );
  assert.equal(
    calculateOtaPrice(input, { ...rule, rounding: "cent" }).feeCents,
    6090,
  );
  assert.equal(
    calculateOtaPrice({ ...input, feeCents: 6000 }, rule).feeCents,
    6000,
  );
  assert.equal(calculateOtaPrice({ ...input, feeCents: 0 }, {}).feeCents, 0);
  assert.throws(() => calculateOtaPrice(input, {}), /commission réelle/);
  assert.throws(
    () => calculateOtaPrice({ ...input, feeCents: 61001 }, rule),
    /dépasse/,
  );
  assert.throws(
    () => calculateOtaPrice({ ...input, amountCents: 2000 }, rule),
    /inférieur/,
  );
});
test("un net ambigu n'est jamais transformé en un brut inventé", () => {
  // 4,50 - 0 = 4,50 and 5,50 - 1 = 4,50.
  assert.throws(
    () =>
      calculateOtaPrice(
        { basis: "net", amountCents: 450, included: empty },
        rule,
      ),
    /Plusieurs prix/,
  );
  assert.equal(
    calculateOtaPrice(
      { basis: "net", amountCents: 450, included: empty, feeCents: 100 },
      rule,
    ).grossCents,
    550,
  );
});
test("inversion du net : vérification exhaustive contre les commissions arrondies", () => {
  for (const rounding of ["cent", "euro"] as const)
    for (const percent of [0, 10, 15, 33.33]) {
      const solutions = new Map<number, number[]>();
      for (let gross = 0; gross <= 20000; gross++) {
        const net = gross - otaCommissionCents(gross, percent, rounding);
        solutions.set(net, [...(solutions.get(net) ?? []), gross]);
      }
      for (const [net, gross] of solutions) {
        if (net > 10000) continue;
        if (gross.length > 1) {
          assert.throws(
            () =>
              calculateOtaPrice(
                { basis: "net", amountCents: net, included: empty },
                { percent, rounding },
              ),
            /Plusieurs prix/,
          );
        } else {
          assert.equal(
            calculateOtaPrice(
              { basis: "net", amountCents: net, included: empty },
              { percent, rounding },
            ).grossCents,
            gross[0],
          );
        }
      }
    }
  assert.equal(otaCommissionCents(52500, 10, "euro"), 5300);
  assert.equal(otaCommissionCents(52499, 10, "euro"), 5200);
});

test("une taxe proportionnelle porte sur l'hébergement et ne réintègre pas les options incluses", async () => {
  const {
    createTouristTaxStay,
    reservationAmountToCollect,
    reservationTouristTax,
  } = await import("../src/touristTax.js");
  const stay = createTouristTaxStay({
    version: 1,
    classified: false,
    stars: 0,
    included: false,
    fixed_rate: 0,
    percentage: 4,
    cap: 100,
    additional_percentage: 0,
    accommodation_vat_rate: 0,
    authority: "Test",
    effective_from: "2026-01-01",
  });
  const reservation = {
    prix_total: 2005,
    nb_nuits: 5,
    nb_adultes: 9,
    frais_optionnels_montant: 0,
    options: {
      tourist_tax: {
        ...stay,
        collector: "platform",
        platform: "Gites de France",
      },
      menage: { enabled: true, inclus: true, montant_inclus: 120 },
      draps: { enabled: true, inclus: true, montant_inclus: 135 },
    },
  };
  assert.equal(reservationTouristTax(reservation)?.accommodation_amount, 1750);
  assert.equal(reservationTouristTax(reservation)?.amount, 70.2);
  assert.equal(reservationAmountToCollect(reservation), 2005);
});
