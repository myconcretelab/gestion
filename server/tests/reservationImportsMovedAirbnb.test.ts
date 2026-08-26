import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import { buildReservationsPreview } from "../src/services/reservationImports.ts";

const activeSource = {
  id: "source-airbnb",
  gite_id: "gite-1",
  type: "Airbnb",
  url: "https://www.airbnb.com/calendar/ical/48504640.ics",
  is_active: true,
  ordre: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  gite: {
    id: "gite-1",
    nom: "Gîte test",
    prefixe_contrat: "TEST",
    ordre: 0,
    nb_adultes_habituel: 2,
  },
};

const movedPumpReservation = {
  id: "48504640|HMNN9C5P4S",
  confirmationCode: "HMNN9C5P4S",
  listingId: "48504640",
  type: "airbnb" as const,
  checkIn: "2026-09-16",
  checkOut: "2026-09-21",
  nights: 5,
  name: "Romain Marques",
  payout: 316.85,
  comment: null,
};

test("Pump prépare une mise à jour de dates quand le code Airbnb existe déjà", async () => {
  const originalSourceFindMany = prisma.icalSource.findMany;
  const originalReservationFindMany = prisma.reservation.findMany;
  const originalReservationFindFirst = prisma.reservation.findFirst;

  try {
    prisma.icalSource.findMany = async () => [activeSource] as any;
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-originale",
        hote_nom: "Romain Marques",
        source_paiement: "Airbnb",
        commentaire: null,
        prix_total: 316.85,
        airbnb_url: "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
        date_entree: new Date("2026-09-23T00:00:00.000Z"),
        date_sortie: new Date("2026-09-28T00:00:00.000Z"),
      },
    ] as any;
    prisma.reservation.findFirst = async () => null;

    const preview = await buildReservationsPreview([movedPumpReservation]);

    assert.equal(preview.counts.existing_updatable, 1);
    assert.equal(preview.counts.new, 0);
    assert.equal(preview.reservations[0]?.existing_id, "reservation-originale");
    assert.deepEqual(preview.reservations[0]?.update_fields, ["dates"]);
  } finally {
    prisma.icalSource.findMany = originalSourceFindMany;
    prisma.reservation.findMany = originalReservationFindMany;
    prisma.reservation.findFirst = originalReservationFindFirst;
  }
});

test("Pump conserve le conflit si une autre réservation occupe les nouvelles dates", async () => {
  const originalSourceFindMany = prisma.icalSource.findMany;
  const originalReservationFindMany = prisma.reservation.findMany;
  const originalReservationFindFirst = prisma.reservation.findFirst;

  try {
    prisma.icalSource.findMany = async () => [activeSource] as any;
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-originale",
        hote_nom: "Romain Marques",
        source_paiement: "Airbnb",
        commentaire: null,
        prix_total: 316.85,
        airbnb_url: "https://www.airbnb.com/hosting/reservations/details/HMNN9C5P4S",
        date_entree: new Date("2026-09-23T00:00:00.000Z"),
        date_sortie: new Date("2026-09-28T00:00:00.000Z"),
      },
    ] as any;
    prisma.reservation.findFirst = async () => ({ id: "reservation-sans-rapport" }) as any;

    const preview = await buildReservationsPreview([movedPumpReservation]);

    assert.equal(preview.counts.conflict, 1);
    assert.equal(preview.reservations[0]?.existing_id, "reservation-originale");
    assert.equal(preview.reservations[0]?.conflict_id, "reservation-sans-rapport");
  } finally {
    prisma.icalSource.findMany = originalSourceFindMany;
    prisma.reservation.findMany = originalReservationFindMany;
    prisma.reservation.findFirst = originalReservationFindFirst;
  }
});

test("Pump rattache son code Airbnb à une réservation iCal trouvée aux mêmes dates", async () => {
  const originalSourceFindMany = prisma.icalSource.findMany;
  const originalReservationFindMany = prisma.reservation.findMany;
  const originalReservationFindFirst = prisma.reservation.findFirst;

  try {
    prisma.icalSource.findMany = async () => [activeSource] as any;
    prisma.reservation.findMany = async () => [];
    prisma.reservation.findFirst = async () => ({
      id: "reservation-ical",
      hote_nom: "Romain Marques",
      source_paiement: "Airbnb",
      commentaire: null,
      prix_total: 316.85,
      airbnb_url: null,
      date_entree: new Date("2026-09-16T00:00:00.000Z"),
      date_sortie: new Date("2026-09-21T00:00:00.000Z"),
    }) as any;

    const preview = await buildReservationsPreview([movedPumpReservation]);

    assert.equal(preview.counts.existing_updatable, 1);
    assert.deepEqual(preview.reservations[0]?.update_fields, ["airbnb_url"]);
  } finally {
    prisma.icalSource.findMany = originalSourceFindMany;
    prisma.reservation.findMany = originalReservationFindMany;
    prisma.reservation.findFirst = originalReservationFindFirst;
  }
});
