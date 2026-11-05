import assert from "node:assert/strict";
import test from "node:test";
import type { ReservationPaymentTracking } from "@contrats/shared";
import { endedStayPaymentAlert } from "../src/modules/finance/reports/paymentAlerts.js";

const now = new Date("2026-11-05T12:00:00Z");
const stay = {
  reservationId: "stay",
  guest: "Voyageur",
  bookingSource: "Direct",
  stays: [
    {
      propertyId: "g",
      propertyLabel: "Gîte",
      arrival: "2026-10-09",
      departure: "2026-10-11",
    },
  ],
};
const tracking: ReservationPaymentTracking = {
  managed: false,
  total: 100,
  received: 0,
  remaining: 100,
  deposit: 0,
  overpaid: 0,
  requires_review: false,
  entries: [],
};
const entry = {
  id: "receipt",
  origin: "manual" as const,
  method: "Chèque",
  purpose: "full",
  amount: 100,
  paid_on: "2026-10-10T12:00:00Z",
  voided_at: null,
  note: null,
};
test("un séjour terminé sans paiement et un acompte incomplet sont signalés au centime", () => {
  assert.equal(
    endedStayPaymentAlert(stay, tracking, new Set(), now)?.reason,
    "missing",
  );
  const partial = endedStayPaymentAlert(
    stay,
    { ...tracking, entries: [{ ...entry, amount: 33.33 }] },
    new Set(),
    now,
  )!;
  assert.equal(partial.reason, "partial");
  assert.equal(partial.receivedCents, 3333);
  assert.equal(partial.remainingCents, 6667);
});
test("les chèques, cartes Stripe et versements de plateforme soldés évitent les faux impayés", () => {
  for (const origin of ["manual", "legacy", "stripe", "platform"] as const)
    assert.equal(
      endedStayPaymentAlert(
        stay,
        { ...tracking, entries: [{ ...entry, origin }] },
        new Set(),
        now,
      ),
      null,
    );
});
test("les règlements annulés et cartes de test ne justifient pas le paiement réel", () => {
  assert.equal(
    endedStayPaymentAlert(
      stay,
      { ...tracking, entries: [{ ...entry, voided_at: "2026-10-12" }] },
      new Set(),
      now,
    )?.reason,
    "missing",
  );
  assert.equal(
    endedStayPaymentAlert(
      stay,
      { ...tracking, entries: [{ ...entry, origin: "stripe" }] },
      new Set(["receipt"]),
      now,
    )?.remainingCents,
    10000,
  );
});
test("une date future, une date absente et un remboursement à vérifier gardent une alerte", () => {
  for (const paid_on of ["2026-11-25T12:00:00Z", null])
    assert.equal(
      endedStayPaymentAlert(
        stay,
        { ...tracking, entries: [{ ...entry, paid_on }] },
        new Set(),
        now,
      )?.reason,
      "review",
    );
  assert.equal(
    endedStayPaymentAlert(
      stay,
      { ...tracking, requires_review: true, entries: [entry] },
      new Set(),
      now,
    )?.reason,
    "review",
  );
});
test("les gratuités, séjours en cours et groupes encore en cours ne sont pas considérés terminés", () => {
  assert.equal(
    endedStayPaymentAlert(stay, { ...tracking, total: 0 }, new Set(), now),
    null,
  );
  assert.equal(
    endedStayPaymentAlert(
      {
        ...stay,
        stays: [...stay.stays, { ...stay.stays[0], departure: "2026-11-06" }],
      },
      tracking,
      new Set(),
      now,
    ),
    null,
  );
  const departureToday = {
    ...stay,
    stays: [{ ...stay.stays[0], departure: "2026-11-05" }],
  };
  assert.equal(
    endedStayPaymentAlert(departureToday, tracking, new Set(), now),
    null,
  );
  assert.ok(
    endedStayPaymentAlert(
      departureToday,
      tracking,
      new Set(),
      new Date("2026-11-05T23:01:00Z"),
    ),
  );
});
test("le contrôle compte un séjour partagé une seule fois et sa révision suit les changements financiers", () => {
  const group = {
    ...stay,
    stays: [...stay.stays, { ...stay.stays[0], propertyId: "g2" }],
  };
  const first = endedStayPaymentAlert(group, tracking, new Set(), now)!;
  assert.equal(first.totalCents, 10000);
  assert.equal(first.stays.length, 2);
  assert.equal(
    first.sourceRevision,
    endedStayPaymentAlert(group, tracking, new Set(), now)!.sourceRevision,
  );
  assert.notEqual(
    first.sourceRevision,
    endedStayPaymentAlert(
      group,
      { ...tracking, entries: [{ ...entry, amount: 10 }] },
      new Set(),
      now,
    )!.sourceRevision,
  );
});
