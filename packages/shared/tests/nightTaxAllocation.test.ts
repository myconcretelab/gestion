import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNightTaxBasis,
  allocateNightTaxCollections,
  computeTouristTax,
  createTouristTaxStay,
  type NightTaxSegment,
  type TouristTaxStay,
} from "../src/index.js";

const stay: TouristTaxStay = {
  ...createTouristTaxStay({
    version: 1,
    classified: true,
    stars: 2,
    included: false,
    fixed_rate: 0.33,
    percentage: 4,
    cap: 4,
    additional_percentage: 10,
    accommodation_vat_rate: 0,
    authority: "Test",
    effective_from: "2026-01-01",
  }),
  collector: "host",
};
const segment = (patch: Partial<NightTaxSegment> = {}): NightTaxSegment => ({
  id: "r1",
  propertyId: "g1",
  arrival: "2026-12-31",
  departure: "2027-01-02",
  nights: 2,
  adults: 1,
  children: 1,
  touristTax: stay,
  ...patch,
});
const tax = (value = stay, nights = 2) =>
  computeTouristTax({
    stay: value,
    nights,
    adults: 1,
    children: 1,
    accommodation: 100,
    start: "2026-12-31",
  });
const collection = (
  id: string,
  amountCents: number,
  paidOn = "2026-12-31",
) => ({ id, amountCents, paidOn, needsReview: false });
test("la ventilation conserve les arrondis par personne et les centimes entre années", () => {
  const basis = buildNightTaxBasis([segment()], tax());
  assert.equal(basis.reason, null);
  assert.deepEqual(
    basis.slices.map((row) => [row.start, row.baseCents, row.additionalCents]),
    [
      ["2026-12-31", 33, 3],
      ["2027-01-01", 33, 3],
    ],
  );
  const allocation = allocateNightTaxCollections(basis, [collection("p1", 72)]);
  assert.deepEqual(allocation.allocations.get("p1"), basis.slices);
});
test("des petites perceptions successives ne réutilisent pas les mêmes centimes", () => {
  const basis = buildNightTaxBasis([segment()], tax());
  const { allocations, reason } = allocateNightTaxCollections(
    basis,
    Array.from({ length: 72 }, (_, i) =>
      collection(`p${String(i).padStart(2, "0")}`, 1),
    ),
  );
  assert.equal(reason, null);
  for (let index = 0; index < 2; index++) {
    assert.equal(
      [...allocations.values()].reduce(
        (sum, rows) => sum + rows[index].baseCents,
        0,
      ),
      33,
    );
    assert.equal(
      [...allocations.values()].reduce(
        (sum, rows) => sum + rows[index].additionalCents,
        0,
      ),
      3,
    );
  }
  for (const slices of allocations.values())
    assert.equal(
      slices.reduce((sum, row) => sum + row.baseCents + row.additionalCents, 0),
      1,
    );
  assert.deepEqual(
    allocateNightTaxCollections(basis, [
      collection("p2", 35),
      collection("p1", 37),
    ]).allocations,
    allocateNightTaxCollections(basis, [
      collection("p1", 37),
      collection("p2", 35),
    ]).allocations,
  );
});
test("les logements successifs gardent leur part sans réaffecter celle des autres logements", () => {
  const segments = [
    segment({ departure: "2027-01-01", nights: 1 }),
    segment({
      id: "r2",
      propertyId: "g2",
      arrival: "2027-01-01",
      departure: "2027-01-03",
    }),
  ];
  const basis = buildNightTaxBasis(segments, tax(stay, 3));
  const slices = allocateNightTaxCollections(basis, [
    collection("p1", 108),
  ]).allocations.get("p1")!;
  assert.deepEqual(
    slices.map((row) => [
      row.reservationId,
      row.baseCents + row.additionalCents,
    ]),
    [
      ["r1", 36],
      ["r2", 72],
    ],
  );
});
test("les groupes hétérogènes, les chevauchements et les montants à revoir ne produisent pas de proposition", () => {
  const first = segment({ departure: "2027-01-01", nights: 1 });
  for (const patch of [
    { adults: 2 },
    { touristTax: { ...stay, settings: { ...stay.settings, fixed_rate: 1 } } },
    { arrival: "2026-12-31", departure: "2027-01-01", nights: 1 },
    { nights: 3 },
  ])
    assert.ok(
      buildNightTaxBasis(
        [
          first,
          segment({
            id: "r2",
            arrival: "2027-01-01",
            departure: "2027-01-03",
            ...patch,
          }),
        ],
        tax(stay, 3),
      ).reason,
    );
  const basis = buildNightTaxBasis([segment()], tax());
  for (const input of [
    [collection("p1", 73)],
    [{ ...collection("p1", 72), needsReview: true }],
  ])
    assert.equal(allocateNightTaxCollections(basis, input).allocations.size, 0);
  assert.equal(
    buildNightTaxBasis(
      [segment({ touristTax: { ...stay, collector: "platform" } })],
      tax(),
    ).slices.length,
    0,
  );
});
test("une taxe proportionnelle incluse se décompose à partir du prix net figé", () => {
  const value = {
    ...stay,
    settings: {
      ...stay.settings,
      classified: false,
      stars: 0,
      included: true,
      additional_percentage: 10,
    },
  };
  const calculated = tax(value);
  const basis = buildNightTaxBasis(
    [segment({ touristTax: value })],
    calculated,
  );
  assert.equal(basis.reason, null);
  assert.equal(
    basis.slices.reduce(
      (sum, row) => sum + row.baseCents + row.additionalCents,
      0,
    ),
    Math.round(calculated.amount * 100),
  );
});

test("les grandes pondérations conservent le centime sans multiplication flottante", () => {
  const allocation = allocateNightTaxCollections(
    {
      reason: null,
      additionalPercentage: 0,
      slices: [
        {
          reservationId: "r1",
          start: "2026-01-01",
          end: "2026-02-01",
          baseCents: 4_000_000_001,
          additionalCents: 0,
        },
        {
          reservationId: "r2",
          start: "2026-02-01",
          end: "2026-03-01",
          baseCents: 4_000_000_000,
          additionalCents: 0,
        },
      ],
    },
    [collection("p", 1_000_000_001)],
  );
  assert.deepEqual(
    allocation.allocations.get("p")!.map((row) => row.baseCents),
    [500_000_001, 500_000_000],
  );
});
