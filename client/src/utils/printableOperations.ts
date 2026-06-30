import type { Reservation } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OperationKind = "arrival" | "departure" | "cleaning" | "linen" | "towels" | "late-checkout";

export type StayOperation = {
  kind: OperationKind;
  label: string;
};

export type PrintableOperationStay = {
  reservation: Reservation;
  operations: StayOperation[];
};

export type PrintableOperationRow = {
  date: string;
  giteId: string;
  stays: PrintableOperationStay[];
};

export const parseIsoDateUtc = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const toIsoDateUtc = (value: Date) => value.toISOString().slice(0, 10);

export const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * DAY_MS);

export const diffUtcDays = (left: Date, right: Date) =>
  Math.round((left.getTime() - right.getTime()) / DAY_MS);

export const enumerateIsoDates = (from: string, to: string) => {
  const start = parseIsoDateUtc(from);
  const end = parseIsoDateUtc(to);
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
    dates.push(toIsoDateUtc(cursor));
  }
  return dates;
};

export const reservationOverlapsPeriod = (reservation: Reservation, from: string, to: string) =>
  reservation.date_entree.slice(0, 10) <= to && reservation.date_sortie.slice(0, 10) >= from;

export const getOperationsForDate = (reservation: Reservation, isoDate: string): StayOperation[] => {
  const operations: StayOperation[] = [];
  const isArrival = reservation.date_entree.slice(0, 10) === isoDate;
  const isDeparture = reservation.date_sortie.slice(0, 10) === isoDate;

  if (isArrival) {
    operations.push({ kind: "arrival", label: "Entrée" });
    if (reservation.options?.draps?.enabled) {
      const beds = reservation.options.draps.nb_lits;
      operations.push({ kind: "linen", label: beds ? `Draps · ${beds} lit${beds > 1 ? "s" : ""}` : "Draps" });
    }
    if (reservation.options?.linge_toilette?.enabled) {
      const guests = reservation.options.linge_toilette.nb_personnes;
      operations.push({
        kind: "towels",
        label: guests ? `Serviettes · ${guests} pers.` : "Serviettes",
      });
    }
  }

  if (isDeparture) {
    operations.push({ kind: "departure", label: "Sortie" });
    if (reservation.options?.menage?.enabled) {
      operations.push({ kind: "cleaning", label: "Ménage" });
    }
    if (reservation.options?.depart_tardif?.enabled) {
      operations.push({ kind: "late-checkout", label: "Départ tardif" });
    }
  }

  return operations;
};

export const buildPrintableOperationRows = (dates: string[], reservations: Reservation[]) => {
  const rows: PrintableOperationRow[] = [];

  for (const date of dates) {
    const rowsByGiteId = new Map<string, PrintableOperationRow>();
    for (const reservation of reservations) {
      if (!reservation.gite_id) continue;
      const operations = getOperationsForDate(reservation, date);
      if (operations.length === 0) continue;

      let row = rowsByGiteId.get(reservation.gite_id);
      if (!row) {
        row = { date, giteId: reservation.gite_id, stays: [] };
        rowsByGiteId.set(reservation.gite_id, row);
        rows.push(row);
      }
      row.stays.push({ reservation, operations });
    }
  }

  for (const row of rows) {
    row.stays.sort((left, right) => {
      const leftIsDeparture = left.operations.some((operation) => operation.kind === "departure");
      const rightIsDeparture = right.operations.some((operation) => operation.kind === "departure");
      return Number(rightIsDeparture) - Number(leftIsDeparture);
    });
  }

  return rows;
};

export const getAlreadyHandledArrivalRowKeys = (rows: PrintableOperationRow[]) => {
  const pendingDepartureByGite = new Set<string>();
  const handledArrivalRows = new Set<string>();

  for (const row of rows) {
    const operations = row.stays.flatMap((stay) => stay.operations);
    const hasArrival = operations.some((operation) => operation.kind === "arrival");
    const hasDeparture = operations.some((operation) => operation.kind === "departure");

    if (hasArrival && hasDeparture) {
      pendingDepartureByGite.delete(row.giteId);
      continue;
    }

    if (hasDeparture) {
      pendingDepartureByGite.add(row.giteId);
      continue;
    }

    if (hasArrival && pendingDepartureByGite.has(row.giteId)) {
      handledArrivalRows.add(`${row.date}-${row.giteId}`);
      pendingDepartureByGite.delete(row.giteId);
    }
  }

  return handledArrivalRows;
};
