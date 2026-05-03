const DAY_MS = 24 * 60 * 60 * 1000;

export type StatisticsGite = {
  id: string;
  nom: string;
  ordre: number;
  prefixe_contrat: string;
  proprietaires_noms: string;
  gestionnaire_id: string | null;
  gestionnaire: {
    id: string;
    prenom: string;
    nom: string;
  } | null;
};

export type StatisticsReservation = {
  id: string;
  gite_id: string | null;
  date_entree: Date;
  date_sortie: Date;
  nb_nuits: number;
  nb_adultes: number;
  prix_par_nuit: number;
  prix_total: number;
  source_paiement: string | null;
  frais_optionnels_montant: number;
  frais_optionnels_declares: boolean;
};

export type StatisticsEntry = {
  reservationId: string;
  giteId: string;
  debut: string;
  fin: string;
  mois: number;
  nuits: number;
  adultes: number;
  prixNuit: number;
  revenus: number;
  fraisOptionnelsTotal: number;
  fraisOptionnelsDeclares: number;
  paiement: string;
  proprietaires: string;
};

export type StatisticsPayload = {
  gites: StatisticsGite[];
  entriesByGite: Record<string, StatisticsEntry[]>;
  availableYears: number[];
};

type Segment = {
  start: Date;
  endDisplay: Date;
  nights: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const pad2 = (value: number) => String(value).padStart(2, "0");

const isoDateOnly = (date: Date) =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

const toUtcDateOnly = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const diffNights = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY_MS);

const isImmediateNextMonth = (start: Date, end: Date) => {
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  return (endYear === startYear && endMonth === startMonth + 1) || (endYear === startYear + 1 && startMonth === 11 && endMonth === 0);
};

const splitByMonth = (start: Date, end: Date): Segment[] => {
  if (end.getTime() <= start.getTime()) return [];

  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth();

  const shouldKeepSingleSegment = sameMonth || (end.getUTCDate() === 1 && isImmediateNextMonth(start, end));
  if (shouldKeepSingleSegment) {
    const nights = diffNights(start, end);
    return nights > 0 ? [{ start, endDisplay: end, nights }] : [];
  }

  const segments: Segment[] = [];
  let cursor = start;

  while (cursor.getTime() < end.getTime()) {
    const monthStartNext = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const segmentEndExclusive = monthStartNext.getTime() < end.getTime() ? monthStartNext : end;
    const nights = diffNights(cursor, segmentEndExclusive);

    if (nights > 0) {
      const endDisplay =
        segmentEndExclusive.getTime() < end.getTime()
          ? new Date(Date.UTC(segmentEndExclusive.getUTCFullYear(), segmentEndExclusive.getUTCMonth(), segmentEndExclusive.getUTCDate() - 1))
          : end;
      segments.push({ start: cursor, endDisplay, nights });
    }

    cursor = segmentEndExclusive;
  }

  return segments;
};

export const buildStatisticsPayload = (params: {
  gites: StatisticsGite[];
  reservations: StatisticsReservation[];
}): StatisticsPayload => {
  const gites = [...params.gites].sort(
    (left, right) => left.ordre - right.ordre || left.nom.localeCompare(right.nom, "fr")
  );

  const gitesById = new Map(gites.map((gite) => [gite.id, gite]));
  const entriesByGite: Record<string, StatisticsEntry[]> = {};
  const years = new Set<number>();

  for (const gite of gites) {
    entriesByGite[gite.id] = [];
  }

  for (const reservation of params.reservations) {
    if (!reservation.gite_id) continue;
    const gite = gitesById.get(reservation.gite_id);
    if (!gite) continue;

    const start = toUtcDateOnly(reservation.date_entree);
    const end = toUtcDateOnly(reservation.date_sortie);
    const segments = splitByMonth(start, end);
    if (segments.length === 0) continue;

    const effectiveNightPrice =
      reservation.prix_par_nuit > 0
        ? reservation.prix_par_nuit
        : reservation.nb_nuits > 0
          ? reservation.prix_total / reservation.nb_nuits
          : 0;
    const prixNuit = round2(effectiveNightPrice);
    const optionalFeesTotal = round2(reservation.frais_optionnels_montant || 0);
    const declaredOptionalFeesTotal = reservation.frais_optionnels_declares
      ? optionalFeesTotal
      : 0;
    const totalSegmentNights = segments.reduce((sum, segment) => sum + segment.nights, 0);
    let allocatedOptionalFees = 0;
    let allocatedDeclaredOptionalFees = 0;

    for (let idx = 0; idx < segments.length; idx += 1) {
      const segment = segments[idx];
      years.add(segment.start.getUTCFullYear());
      const isLastSegment = idx === segments.length - 1;
      const proportionalOptionalFees =
        totalSegmentNights > 0 ? round2((optionalFeesTotal * segment.nights) / totalSegmentNights) : 0;
      const optionalFeesForSegment = isLastSegment
        ? round2(optionalFeesTotal - allocatedOptionalFees)
        : proportionalOptionalFees;
      allocatedOptionalFees = round2(allocatedOptionalFees + optionalFeesForSegment);
      const proportionalDeclaredOptionalFees =
        totalSegmentNights > 0 ? round2((declaredOptionalFeesTotal * segment.nights) / totalSegmentNights) : 0;
      const declaredOptionalFeesForSegment = isLastSegment
        ? round2(declaredOptionalFeesTotal - allocatedDeclaredOptionalFees)
        : proportionalDeclaredOptionalFees;
      allocatedDeclaredOptionalFees = round2(allocatedDeclaredOptionalFees + declaredOptionalFeesForSegment);

      entriesByGite[gite.id].push({
        reservationId: reservation.id,
        giteId: gite.id,
        debut: isoDateOnly(segment.start),
        fin: isoDateOnly(segment.endDisplay),
        mois: segment.start.getUTCMonth() + 1,
        nuits: segment.nights,
        adultes: reservation.nb_adultes ?? 0,
        prixNuit,
        revenus: round2(prixNuit * segment.nights),
        fraisOptionnelsTotal: optionalFeesForSegment,
        fraisOptionnelsDeclares: declaredOptionalFeesForSegment,
        paiement: (reservation.source_paiement ?? "Indéfini").trim() || "Indéfini",
        proprietaires: gite.proprietaires_noms,
      });
    }
  }

  for (const giteId of Object.keys(entriesByGite)) {
    entriesByGite[giteId].sort(
      (left, right) =>
        left.debut.localeCompare(right.debut) ||
        left.fin.localeCompare(right.fin) ||
        left.reservationId.localeCompare(right.reservationId)
    );
  }

  return {
    gites,
    entriesByGite,
    availableYears: [...years].sort((a, b) => b - a),
  };
};
