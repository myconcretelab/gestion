import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTouristTaxCollection,
  createTouristTaxStayForSource,
  DEFAULT_TOURIST_TAX_COLLECTION,
  touristTaxCollectionSettingsSchema,
  touristTaxReapplySchema,
} from "../src/touristTaxCollection.js";
import {
  computeTouristTax,
  type TouristTaxSettings,
} from "../src/touristTax.js";
const policy: TouristTaxSettings = {
  version: 1,
  classified: true,
  stars: 1,
  included: true,
  fixed_rate: 0.8,
  percentage: 4,
  cap: 4,
  additional_percentage: 0,
  accommodation_vat_rate: 0,
  authority: "Ploërmel",
  effective_from: "2026-01-01",
};
const calculate = (stay: ReturnType<typeof createTouristTaxStayForSource>) =>
  computeTouristTax({
    stay,
    accommodation: 100,
    adults: 2,
    children: 0,
    nights: 2,
  });
test("le direct reprend le prix du gîte, Airbnb ne déduit pas une taxe déjà exclue du prix importé", () => {
  const direct = calculate(
    createTouristTaxStayForSource(
      policy,
      "Direct",
      DEFAULT_TOURIST_TAX_COLLECTION,
    ),
  );
  assert.equal(direct.amount, 3.2);
  assert.equal(direct.accommodation_amount, 96.8);
  assert.equal(direct.host_amount, 3.2);
  const platform = calculate(
    createTouristTaxStayForSource(
      policy,
      "Airbnb",
      DEFAULT_TOURIST_TAX_COLLECTION,
    ),
  );
  assert.equal(platform.accommodation_amount, 100);
  assert.equal(platform.host_amount, 0);
  assert.equal(platform.platform, "Airbnb");
});
test("une nouvelle plateforme attend un choix, puis peut déléguer la collecte au gestionnaire", () => {
  assert.equal(
    createTouristTaxStayForSource(
      policy,
      "Nouveau canal",
      DEFAULT_TOURIST_TAX_COLLECTION,
    ).collector,
    "unknown",
  );
  const stay = createTouristTaxStayForSource(policy, "Nouveau canal", {
    rules: [{ source: "Nouveau canal", collector: "host", price: "excluded" }],
  });
  const tax = calculate(stay);
  assert.equal(tax.accommodation_amount + tax.host_amount, 103.2);
});
test("un changement d’origine restaure le prix du gîte et préserve les exonérations et les exceptions manuelles", () => {
  const direct = {
    ...createTouristTaxStayForSource(
      policy,
      "Direct",
      DEFAULT_TOURIST_TAX_COLLECTION,
    ),
    infants: 1,
    exempt_adults: 1,
    exemption_reason: "Exonération justifiée",
  };
  const platform = applyTouristTaxCollection(
    direct,
    "Airbnb",
    DEFAULT_TOURIST_TAX_COLLECTION,
  );
  assert.equal(platform.collector, "platform");
  assert.equal(platform.settings.included, false);
  assert.equal(platform.infants, 1);
  assert.equal(
    applyTouristTaxCollection(
      platform,
      "Direct",
      DEFAULT_TOURIST_TAX_COLLECTION,
    ).settings.included,
    true,
  );
  const manual = {
    ...direct,
    collector_mode: "manual" as const,
    price_mode: "manual" as const,
  };
  const preserved = applyTouristTaxCollection(
    manual,
    "Airbnb",
    DEFAULT_TOURIST_TAX_COLLECTION,
  );
  assert.equal(preserved.collector, "host");
  assert.equal(preserved.settings.included, true);
});
test("modifier les règles globales ne recalcule pas un séjour enregistré tant que l’origine reste identique", () => {
  const stay = createTouristTaxStayForSource(
    policy,
    "Direct",
    DEFAULT_TOURIST_TAX_COLLECTION,
  );
  const modified = {
    rules: [
      {
        source: "Direct",
        collector: "unknown" as const,
        price: "excluded" as const,
      },
    ],
  };
  assert.deepEqual(applyTouristTaxCollection(stay, "Direct", modified), stay);
  assert.equal(
    applyTouristTaxCollection(stay, "Direct", modified, true).collector,
    "unknown",
  );
});
test("les règles rejettent les doublons, dates invalides et périodes inversées", () => {
  assert.equal(
    touristTaxCollectionSettingsSchema.safeParse({
      rules: [
        DEFAULT_TOURIST_TAX_COLLECTION.rules[0],
        { ...DEFAULT_TOURIST_TAX_COLLECTION.rules[0], source: "direct" },
      ],
    }).success,
    false,
  );
  for (const scope of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-01", to: "2026-09-01" },
  ])
    assert.equal(touristTaxReapplySchema.safeParse(scope).success, false);
});
