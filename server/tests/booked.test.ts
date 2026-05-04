import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import bookedRouter from "../src/routes/bookingRequests.ts";
import { BookedValidationError, computeSeasonQuote } from "../src/services/booked.ts";

const getRouteHandler = (router: any, method: "get" | "post", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

const createMockResponse = () => ({
  statusCode: 200,
  body: null as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
});

test("computeSeasonQuote calcule un séjour multi-saisons nuit par nuit", async () => {
  const quote = await computeSeasonQuote({
    gite: {
      id: "g1",
      capacite_max: 6,
      nb_adultes_max: 4,
      nb_enfants_max: 2,
      taxe_sejour_par_personne_par_nuit: 1.5,
      options_draps_par_lit: 12,
      options_linge_toilette_par_personne: 8,
      options_menage_forfait: 20,
      options_depart_tardif_forfait: 15,
      options_chiens_forfait: 5,
      arrhes_taux_defaut: 0.2,
      regle_animaux_acceptes: true,
      regle_bois_premiere_flambee: false,
      regle_tiers_personnes_info: false,
    },
    dateEntree: new Date("2026-07-30T00:00:00.000Z"),
    dateSortie: new Date("2026-08-02T00:00:00.000Z"),
    nbAdultes: 2,
    nbEnfants: 1,
    options: {
      menage: { enabled: true },
      chiens: { enabled: true, nb: 1 },
    },
    seasonRates: [
      {
        id: "s1",
        gite_id: "g1",
        date_debut: new Date("2026-07-01T00:00:00.000Z"),
        date_fin: new Date("2026-08-01T00:00:00.000Z"),
        prix_par_nuit: 100,
        min_nuits: 2,
        ordre: 0,
      },
      {
        id: "s2",
        gite_id: "g1",
        date_debut: new Date("2026-08-01T00:00:00.000Z"),
        date_fin: new Date("2026-09-01T00:00:00.000Z"),
        prix_par_nuit: 140,
        min_nuits: 2,
        ordre: 1,
      },
    ],
  });

  assert.equal(quote.nb_nuits, 3);
  assert.equal(quote.montant_hebergement, 340);
  assert.equal(quote.total_options, 35);
  assert.equal(quote.taxe_sejour, 9);
  assert.equal(quote.total_global, 375);
  assert.deepEqual(quote.nightly_breakdown.map((item) => item.prix_par_nuit), [100, 100, 140]);
});

test("computeSeasonQuote refuse un séjour avec trou tarifaire", async () => {
  await assert.rejects(
    () =>
      computeSeasonQuote({
        gite: {
          id: "g1",
          capacite_max: 4,
          nb_adultes_max: 4,
          nb_enfants_max: 0,
          taxe_sejour_par_personne_par_nuit: 0,
          options_draps_par_lit: 0,
          options_linge_toilette_par_personne: 0,
          options_menage_forfait: 0,
          options_depart_tardif_forfait: 0,
          options_chiens_forfait: 0,
          arrhes_taux_defaut: 0.2,
          regle_animaux_acceptes: false,
          regle_bois_premiere_flambee: false,
          regle_tiers_personnes_info: false,
        },
        dateEntree: new Date("2026-07-30T00:00:00.000Z"),
        dateSortie: new Date("2026-08-02T00:00:00.000Z"),
        nbAdultes: 2,
        nbEnfants: 0,
        seasonRates: [
          {
            id: "s1",
            gite_id: "g1",
            date_debut: new Date("2026-07-01T00:00:00.000Z"),
            date_fin: new Date("2026-07-31T00:00:00.000Z"),
            prix_par_nuit: 100,
            min_nuits: 1,
            ordre: 0,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof BookedValidationError && error.code === "season_gap"
  );
});

test("POST /booking-requests/:id/approve crée une réservation booked avec les enfants", async () => {
  const originals = {
    bookingRequestUpdateMany: prisma.bookingRequest.updateMany,
    bookingRequestFindUnique: prisma.bookingRequest.findUnique,
    bookingRequestFindMany: prisma.bookingRequest.findMany,
    bookingRequestUpdate: prisma.bookingRequest.update,
    reservationFindMany: prisma.reservation.findMany,
    $transaction: prisma.$transaction,
  };

  let createdReservationData: any = null;

  try {
    prisma.bookingRequest.updateMany = async () => ({ count: 0 } as any);
    prisma.bookingRequest.findMany = async () => [];
    prisma.reservation.findMany = async () => [];
    prisma.bookingRequest.findUnique = async () => ({
      id: "br1",
      gite_id: "g1",
      approved_reservation_id: null,
      hote_nom: "Client Booked",
      telephone: "0600000000",
      email: null,
      date_entree: new Date("2026-09-10T00:00:00.000Z"),
      date_sortie: new Date("2026-09-14T00:00:00.000Z"),
      nb_nuits: 4,
      nb_adultes: 2,
      nb_enfants_2_17: 2,
      options: JSON.stringify({ menage: { enabled: true } }),
      message_client: "bonjour",
      pricing_snapshot: JSON.stringify({
        nb_nuits: 4,
        montant_hebergement: 520,
        total_options: 20,
        taxe_sejour: 12,
        total_global: 540,
      }),
      status: "pending",
      hold_expires_at: new Date(Date.now() + 60_000),
      decided_at: null,
      decision_note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      gite: { id: "g1", nom: "Gite booked", email: "owner@example.com" },
      approved_reservation: null,
    } as any);
    prisma.$transaction = async (callback: any) =>
      callback({
        reservation: {
          create: async ({ data }: any) => {
            createdReservationData = data;
            return { id: "r-booked-1" };
          },
        },
        bookingRequest: {
          update: async ({ data }: any) => ({
            id: "br1",
            gite_id: "g1",
            approved_reservation_id: "r-booked-1",
            hote_nom: "Client Booked",
            telephone: "0600000000",
            email: null,
            date_entree: new Date("2026-09-10T00:00:00.000Z"),
            date_sortie: new Date("2026-09-14T00:00:00.000Z"),
            nb_nuits: 4,
            nb_adultes: 2,
            nb_enfants_2_17: 2,
            options: JSON.stringify({ menage: { enabled: true } }),
            message_client: "bonjour",
            pricing_snapshot: JSON.stringify({
              nb_nuits: 4,
              montant_hebergement: 520,
              total_options: 20,
              taxe_sejour: 12,
              total_global: 540,
            }),
            status: data.status,
            hold_expires_at: new Date(Date.now() + 60_000),
            decided_at: data.decided_at,
            decision_note: data.decision_note,
            createdAt: new Date(),
            updatedAt: new Date(),
            gite: { id: "g1", nom: "Gite booked", email: "owner@example.com" },
            approved_reservation: {
              id: "r-booked-1",
              hote_nom: "Client Booked",
              date_entree: new Date("2026-09-10T00:00:00.000Z"),
              date_sortie: new Date("2026-09-14T00:00:00.000Z"),
            },
          }),
        },
      });

    const approve = getRouteHandler(bookedRouter, "post", "/:id/approve");
    const response = createMockResponse();
    let nextError: unknown = null;

    await approve(
      {
        params: { id: "br1" },
        body: { decision_note: "OK" },
      },
      response,
      (error) => {
        nextError = error ?? null;
      }
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.equal(createdReservationData.origin_system, "booked");
    assert.equal(createdReservationData.nb_enfants_2_17, 2);
    assert.equal(createdReservationData.prix_total, 520);
  } finally {
    prisma.bookingRequest.updateMany = originals.bookingRequestUpdateMany;
    prisma.bookingRequest.findUnique = originals.bookingRequestFindUnique;
    prisma.bookingRequest.findMany = originals.bookingRequestFindMany;
    prisma.bookingRequest.update = originals.bookingRequestUpdate;
    prisma.reservation.findMany = originals.reservationFindMany;
    prisma.$transaction = originals.$transaction;
  }
});
