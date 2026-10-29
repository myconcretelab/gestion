import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPaymentLinkShareHrefs } from "../src/utils/reservationPaymentSharing";
import ReservationPaymentLinkShareActions from "../src/pages/shared/ReservationPaymentLinkShareActions";

const reservation = { id: "r1", hote_nom: "Camille & Léa", date_entree: "2026-11-01", date_sortie: "2026-11-04", telephone: "+33 6 12 34 56 78", email: " camille+sejour@example.com " };
const link = { purpose: "deposit" as const, amount: 120.5, url: "https://gestion.example.com/p/abc" };

test("les messages SMS et e-mail contiennent le lien, les dates, le montant et les arrhes", () => {
  const hrefs = buildPaymentLinkShareHrefs(reservation, link);
  assert.match(hrefs.sms!, /^sms:\+33612345678[?&]body=/);
  const body = decodeURIComponent(hrefs.sms!.split("body=")[1]);
  for (const text of ["Camille & Léa", "arrhes", "01/11/2026", "04/11/2026", "120,50", link.url]) assert.ok(body.includes(text));
  assert.match(hrefs.email!, /^mailto:camille%2Bsejour%40example.com\?subject=/);
  const params = new URLSearchParams(hrefs.email!.split("?")[1]);
  assert.equal(params.get("body"), body);
  assert.match(params.get("subject")!, /séjour/);
  assert.match(decodeURIComponent(buildPaymentLinkShareHrefs(reservation, { ...link, purpose: "balance" }).sms!), /montant restant/);
});

test("chaque canal s’affiche uniquement si les coordonnées correspondantes existent", () => {
  const render = (contact: { telephone?: string | null; email?: string | null }) => renderToStaticMarkup(createElement(ReservationPaymentLinkShareActions, { reservation: { ...reservation, telephone: null, email: null, ...contact }, link }));
  const sms = render({ telephone: reservation.telephone });
  assert.match(sms, /Envoyer par SMS/);
  assert.doesNotMatch(sms, /mailto:|target=/);
  const email = render({ email: reservation.email });
  assert.match(email, /Envoyer par e-mail/);
  assert.doesNotMatch(email, /sms:|target=/);
  assert.equal(render({}), "");
});

test("le SMS prérempli utilise le séparateur iOS sur iPhone et iPad", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    for (const device of [{ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }, { userAgent: "Safari", platform: "MacIntel", maxTouchPoints: 5 }]) {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: device });
      assert.match(buildPaymentLinkShareHrefs(reservation, link).sms!, /^sms:\+33612345678&body=/);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
