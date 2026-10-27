import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReservationPaymentTracking } from "@contrats/shared";
import ReservationPaymentsEditor from "../src/pages/shared/ReservationPaymentsEditor";
import { setCurrentAuthUser } from "../src/utils/auth";

const tracking: ReservationPaymentTracking = {
  managed: true,
  total: 1000,
  deposit: 300,
  received: 300,
  remaining: 700,
  overpaid: 0,
  requires_review: false,
  entries: [],
};
const render = (overrides: Partial<ReservationPaymentTracking> = {}) =>
  renderToStaticMarkup(
    createElement(ReservationPaymentsEditor, {
      reservation: {
        id: "test",
        source_paiement: "Virement",
        booking_source: "Direct",
      },
      tracking: { ...tracking, ...overrides },
    }),
  );

test("les trois raccourcis affichent le montant réellement restant et gardent la saisie détaillée", () => {
  const html = render();
  assert.match(html, /Ajouter un règlement/);
  for (const method of ["chèque", "espèces", "virement"])
    assert.match(
      html,
      new RegExp(`Encaisser tout le reste à payer : 700,00.*par ${method}`),
    );
  assert.equal(
    (html.match(/class="reservation-ledger__shortcut"/g) || []).length,
    3,
  );
});

test("les raccourcis configurés remplacent les défauts et disparaissent après paiement des arrhes", () => {
  const shortcut = {
    id: "arrhes",
    label: "Arrhes",
    method: "Chèque" as const,
    target: "deposit" as const,
    color: "#FFFF00",
  };
  const html = render({
    received: 100,
    remaining: 900,
    payment_shortcuts: [shortcut],
  });
  assert.match(html, /Encaisser les arrhes restantes : 200,00/);
  assert.match(html, /background-color:#FFFF00;color:#111827/);
  assert.doesNotMatch(html, />Esp\.</);
  assert.doesNotMatch(
    render({ payment_shortcuts: [shortcut] }),
    /class="reservation-ledger__shortcut"/,
  );
  assert.doesNotMatch(
    render({ payment_shortcuts: [] }),
    /class="reservation-ledger__shortcut"/,
  );
});

test("un séjour payé ou à vérifier ne propose aucun encaissement rapide", () => {
  for (const override of [
    { remaining: 0, received: 1000 },
    { requires_review: true },
  ]) {
    const html = render(override);
    assert.doesNotMatch(
      html,
      /class="reservation-ledger__shortcut"|Ajouter un règlement/,
    );
  }
});

test("la lecture seule et les montants masqués ne donnent pas accès aux raccourcis", () => {
  try {
    for (const permissions of [
      { canViewAmounts: true, canWrite: false },
      { canViewAmounts: false, canWrite: true },
    ]) {
      setCurrentAuthUser({
        permissions: { ...permissions, isOwner: false },
        pageAccess: ["reservations"],
      } as any);
      assert.doesNotMatch(
        render(),
        /class="reservation-ledger__shortcut"|Ajouter un règlement/,
      );
    }
  } finally {
    setCurrentAuthUser(null);
  }
});
