import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import prisma from "../src/db/prisma.ts";
import router from "../src/routes/bookingRequests.ts";
import { hydrateBookingRequest, reviseBookingRequestOptions } from "../src/services/booked.ts";
import { buildBookingRequestApprovedMessage } from "../src/services/bookingRequestEmail.ts";
import { fromJsonString } from "../src/utils/jsonFields.ts";

const gite = {
  id: "g1", nom: "Gîte test", regle_animaux_acceptes: true,
  options_draps_par_lit: 12, options_linge_toilette_par_personne: 8,
  options_menage_forfait: 60, options_depart_tardif_forfait: 20, options_chiens_forfait: 5,
  taxe_sejour_par_personne_par_nuit: 99,
} as any;
const quote = {
  nb_nuits: 3, montant_hebergement: 300, total_options: 60, taxe_sejour: 9,
  total_global: 369, arrhes_theoriques: 90,
  nightly_breakdown: [{ date: "2027-06-01", prix_par_nuit: 100 }],
  tourist_tax: { collector: "host" }, tourist_tax_result: { amount: 9, host_amount: 9 },
  options_detail: { draps: 0, linge: 0, menage: 60, depart_tardif: 0, chiens: 0 },
} as any;
const pending = {
  id: "request-options", gite_id: "g1", status: "pending", hold_expires_at: new Date(Date.now() + 60_000),
  date_entree: new Date("2027-06-01T00:00:00Z"), date_sortie: new Date("2027-06-04T00:00:00Z"),
  nb_nuits: 3, nb_adultes: 2, nb_enfants_2_17: 0, hote_nom: "Client test", email: null,
  gite, options: JSON.stringify({ menage: { enabled: true, declared: true }, tourist_tax: quote.tourist_tax }),
  pricing_snapshot: JSON.stringify(quote),
};
const response = () => ({
  statusCode: 200, body: null as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});
const stub = (t: any, object: any, key: string, implementation: any) => {
  const original = object[key];
  object[key] = implementation;
  t.after(() => { object[key] = original; });
};
const handler = (path: string) => (router as any).stack.find((layer: any) => layer.route?.path === path && layer.route.methods.post).route.stack[0].handle;

test("ajouter un chien conserve l’hébergement, la taxe et les arrhes déjà annoncés", () => {
  const revised = reviseBookingRequestOptions({ gite, quote, nbAdultes: 2, options: { menage: { enabled: true }, chiens: { enabled: true, nb: 1 } } });
  assert.equal(revised.quote.options_detail.chiens, 15);
  assert.equal(revised.quote.total_options, 75);
  assert.equal(revised.quote.total_global, 384);
  const { options_unit_prices, ...revisedQuote } = revised.quote;
  assert.equal(options_unit_prices.chiens, 5);
  assert.deepEqual({ ...revisedQuote, total_options: quote.total_options, total_global: quote.total_global, options_detail: quote.options_detail }, quote);
  const removed = reviseBookingRequestOptions({ gite, quote: revised.quote, nbAdultes: 2, options: { menage: { enabled: true }, chiens: { enabled: false, nb: 1 } } });
  assert.equal(removed.quote.total_global, 369);
});

test("quantités, tarifs personnalisés et options offertes sont pris en compte", () => {
  const revised = reviseBookingRequestOptions({ gite, quote, nbAdultes: 2, options: {
    draps: { enabled: true, nb_lits: 2, prix_unitaire: 10 }, linge_toilette: { enabled: true, nb_personnes: 3 },
    chiens: { enabled: true, nb: 2, prix_unitaire: 4 }, menage: { enabled: true, offert: true }, depart_tardif: { enabled: true, prix_forfait: 15 },
  } });
  assert.deepEqual(revised.quote.options_detail, { draps: 20, linge: 24, chiens: 24, menage: 0, depart_tardif: 15 });
  assert.equal(revised.quote.total_global, 392);
});

test("une règle interdisant les animaux produit une erreur au lieu d’un supplément ignoré", () => {
  assert.throws(() => reviseBookingRequestOptions({ gite, quote, nbAdultes: 2, options: { regle_animaux_acceptes: false, chiens: { enabled: true, nb: 1 } } }), /Autorisez les animaux/);
});

test("l’enregistrement alimente le total, l’email et la réservation approuvée", async (t) => {
  let stored: any = { ...pending };
  let reservation: any;
  stub(t, prisma.bookingRequest, "updateMany", async () => ({ count: 0 }));
  stub(t, prisma.bookingRequest, "findUnique", async () => stored);
  stub(t, prisma.gite, "findUnique", async () => gite);
  stub(t, prisma.bookingRequest, "update", async ({ data }: any) => (stored = { ...stored, ...data }));
  stub(t, prisma.bookingRequest, "findMany", async () => []);
  stub(t, prisma.reservation, "findMany", async () => []);
  stub(t, prisma, "$transaction", async (callback: any) => callback({
    gite: { update: async () => ({}) },
    reservation: { findFirst: async () => null, create: async ({ data }: any) => { reservation = data; return { id: "reservation-options" }; } },
    bookingRequest: { findFirst: async () => null, update: async ({ data }: any) => (stored = { ...stored, ...data }) },
  }));
  const res = response();
  await handler("/:id/options")({ params: { id: stored.id }, body: { options: { chiens: { enabled: true, nb: 1 } } } }, res, (error: unknown) => { throw error; });
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.pricing_snapshot.total_global, 384);
  assert.equal(res.body.options.menage.declared, true);
  assert.deepEqual(res.body.options.tourist_tax, quote.tourist_tax);
  assert.match(buildBookingRequestApprovedMessage(hydrateBookingRequest(stored)).text, /Chiens : 5.*× 3 nuits = 15/);
  await handler("/:id/approve")({ params: { id: stored.id }, body: {} }, response(), (error: unknown) => { throw error; });
  assert.equal(reservation.prix_total, 300);
  assert.equal(reservation.frais_optionnels_montant, 75);
  assert.match(reservation.frais_optionnels_libelle, /Chiens/);
  assert.deepEqual(fromJsonString(reservation.options, {}).chiens, { enabled: true, nb: 1 });
});

test("les demandes clôturées, expirées ou introuvables ne sont pas modifiées", async (t) => {
  stub(t, prisma.bookingRequest, "updateMany", async () => ({ count: 0 }));
  let updateCount = 0;
  stub(t, prisma.bookingRequest, "update", async () => { updateCount++; throw new Error("unexpected write"); });
  let requestValue: any;
  stub(t, prisma.bookingRequest, "findUnique", async () => requestValue);
  for (const [value, code] of [[null, 404], [{ ...pending, status: "approved" }, 409], [{ ...pending, status: "expired" }, 409], [{ ...pending, hold_expires_at: new Date(0) }, 409]] as const) {
    requestValue = value;
    const res = response();
    await handler("/:id/options")({ params: { id: pending.id }, body: { options: { chiens: { enabled: true, nb: 1 } } } }, res, (error: unknown) => { throw error; });
    assert.equal(res.statusCode, code);
  }
  assert.equal(updateCount, 0);
});

test("les quantités nulles, négatives ou fractionnaires sont refusées", async (t) => {
  stub(t, prisma.bookingRequest, "updateMany", async () => ({ count: 0 }));
  for (const count of [undefined, 0, -1, 1.5]) {
    let error: unknown;
    await handler("/:id/options")({ params: { id: pending.id }, body: { options: { chiens: { enabled: true, nb: count } } } }, response(), (value: unknown) => { error = value; });
    assert.ok(error instanceof ZodError);
  }
});

test("une modification concurrente impose de recharger la demande", async (t) => {
  stub(t, prisma.bookingRequest, "updateMany", async () => ({ count: 0 }));
  stub(t, prisma.bookingRequest, "findUnique", async () => pending);
  stub(t, prisma.gite, "findUnique", async () => gite);
  stub(t, prisma.bookingRequest, "update", async ({ where }: any) => {
    assert.equal(where.status, "pending");
    assert.ok(where.hold_expires_at.gt instanceof Date);
    throw new Prisma.PrismaClientKnownRequestError("Record changed", { code: "P2025", clientVersion: "test" });
  });
  const res = response();
  await handler("/:id/options")({ params: { id: pending.id }, body: { options: { chiens: { enabled: true, nb: 1 } } } }, res, (error: unknown) => { throw error; });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "request_changed");
});
