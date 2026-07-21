import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrintableOperationRows,
  enumerateIsoDates,
  filterArrivalOperationRows,
  getAlreadyHandledArrivalRowKeys,
  getOperationsForDate,
  reservationOverlapsPeriod,
} from "../src/utils/printableOperations";
import type { Reservation } from "../src/utils/types";

const reservation = {
  id: "reservation-1",
  hote_nom: "Martin",
  date_entree: "2026-07-10",
  date_sortie: "2026-07-13",
  nb_nuits: 3,
  nb_adultes: 2,
  nb_enfants_2_17: 0,
  prix_par_nuit: 100,
  prix_total: 300,
  remise_montant: 0,
  commission_channel_value: 0,
  frais_optionnels_montant: 0,
  frais_optionnels_declares: false,
  energy_consumption_kwh: 0,
  energy_cost_eur: 0,
  options: {
    draps: { enabled: true, nb_lits: 2 },
    linge_toilette: { enabled: true, nb_personnes: 3 },
    menage: { enabled: true },
    depart_tardif: { enabled: true },
  },
} as Reservation;

test("énumère la période avec ses deux bornes", () => {
  assert.deepEqual(enumerateIsoDates("2026-07-10", "2026-07-12"), ["2026-07-10", "2026-07-11", "2026-07-12"]);
});

test("décrit les préparations à l'entrée", () => {
  assert.deepEqual(getOperationsForDate(reservation, "2026-07-10").map((item) => item.label), [
    "Entrée",
    "Draps · 2 lits",
    "Serviettes · 3 pers.",
  ]);
});

test("décrit le ménage et le départ tardif à la sortie", () => {
  assert.deepEqual(getOperationsForDate(reservation, "2026-07-13").map((item) => item.label), [
    "Sortie",
    "Ménage",
    "Départ tardif",
  ]);
});

test("n'affiche pas de ménage à la sortie quand l'option n'est pas activée", () => {
  const withoutCleaning = {
    ...reservation,
    options: {
      ...reservation.options,
      menage: { enabled: false },
    },
  };

  assert.deepEqual(getOperationsForDate(withoutCleaning, "2026-07-13").map((item) => item.label), [
    "Sortie",
    "Départ tardif",
  ]);
});

test("conserve un séjour qui chevauche la période", () => {
  assert.equal(reservationOverlapsPeriod(reservation, "2026-07-12", "2026-07-15"), true);
  assert.equal(reservationOverlapsPeriod(reservation, "2026-07-14", "2026-07-15"), false);
});

test("fusionne une sortie et une entrée le même jour dans le même gîte", () => {
  const departingReservation = { ...reservation, gite_id: "gite-1" };
  const arrivingReservation = {
    ...reservation,
    id: "reservation-2",
    gite_id: "gite-1",
    hote_nom: "Durand",
    date_entree: "2026-07-13",
    date_sortie: "2026-07-15",
    options: {},
  } as Reservation;

  const rows = buildPrintableOperationRows(["2026-07-13"], [arrivingReservation, departingReservation]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].stays.map((stay) => stay.reservation.id), ["reservation-1", "reservation-2"]);
  assert.deepEqual(rows[0].stays.flatMap((stay) => stay.operations.map((operation) => operation.kind)), [
    "departure",
    "cleaning",
    "late-checkout",
    "arrival",
  ]);
});

test("le filtre d'entrées conserve les rotations et masque les sorties seules", () => {
  const arrivingReservation = {
    ...reservation,
    id: "reservation-2",
    gite_id: "gite-1",
    date_entree: "2026-07-13",
    date_sortie: "2026-07-15",
    options: {},
  } as Reservation;
  const rows = buildPrintableOperationRows(
    ["2026-07-13", "2026-07-15"],
    [{ ...reservation, gite_id: "gite-1" }, arrivingReservation],
  );

  assert.deepEqual(
    filterArrivalOperationRows(rows, true).map((row) => row.date),
    ["2026-07-13"],
  );
  assert.equal(filterArrivalOperationRows(rows, false).length, 2);
});

test("grise la prochaine entrée après une sortie séparée", () => {
  const departingReservation = { ...reservation, gite_id: "gite-1" };
  const arrivingReservation = {
    ...reservation,
    id: "reservation-2",
    gite_id: "gite-1",
    date_entree: "2026-07-15",
    date_sortie: "2026-07-18",
    options: {},
  } as Reservation;
  const rows = buildPrintableOperationRows(["2026-07-13", "2026-07-15"], [departingReservation, arrivingReservation]);

  assert.deepEqual([...getAlreadyHandledArrivalRowKeys(rows)], ["2026-07-15-gite-1"]);
});

test("ne grise pas une rotation réalisée le même jour", () => {
  const rows = [
    {
      date: "2026-07-13",
      giteId: "gite-1",
      stays: [
        { reservation, operations: [{ kind: "departure" as const, label: "Sortie" }] },
        { reservation: { ...reservation, id: "reservation-2" }, operations: [{ kind: "arrival" as const, label: "Entrée" }] },
      ],
    },
    {
      date: "2026-07-14",
      giteId: "gite-1",
      stays: [{ reservation: { ...reservation, id: "reservation-3" }, operations: [{ kind: "arrival" as const, label: "Entrée" }] }],
    },
  ];

  assert.deepEqual([...getAlreadyHandledArrivalRowKeys(rows)], []);
});
