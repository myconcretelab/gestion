const DAY_MS = 24 * 60 * 60 * 1000;

export type ReservationMonthlyAmountsInput = {
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  prix_total: number;
  frais_optionnels_montant?: number | null;
  frais_optionnels_declares?: boolean;
};

export type ReservationMonthlyAmounts = {
  baseRevenue: number;
  totalFees: number;
  declaredFees: number;
  undeclaredFees: number;
  total: number;
  nights: number;
};

type Segment = {
  start: Date;
  nights: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const toUtcDateOnly = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

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
    return nights > 0 ? [{ start, nights }] : [];
  }

  const segments: Segment[] = [];
  let cursor = start;

  while (cursor.getTime() < end.getTime()) {
    const monthStartNext = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const segmentEndExclusive = monthStartNext.getTime() < end.getTime() ? monthStartNext : end;
    const nights = diffNights(cursor, segmentEndExclusive);

    if (nights > 0) {
      segments.push({ start: cursor, nights });
    }

    cursor = segmentEndExclusive;
  }

  return segments;
};

export const getReservationMonthlyAmountsForMonth = (
  reservation: ReservationMonthlyAmountsInput,
  year: number,
  month: number
): ReservationMonthlyAmounts => {
  const start = toUtcDateOnly(reservation.date_entree);
  const end = toUtcDateOnly(reservation.date_sortie);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return {
      baseRevenue: 0,
      totalFees: 0,
      declaredFees: 0,
      undeclaredFees: 0,
      total: 0,
      nights: 0,
    };
  }

  const segments = splitByMonth(start, end);
  if (segments.length === 0) {
    return {
      baseRevenue: 0,
      totalFees: 0,
      declaredFees: 0,
      undeclaredFees: 0,
      total: 0,
      nights: 0,
    };
  }

  const effectiveNightPrice =
    Number(reservation.nb_nuits ?? 0) > 0
      ? round2(Number(reservation.prix_total ?? 0) / Number(reservation.nb_nuits ?? 0))
      : 0;
  const optionalFeesTotal = round2(Number(reservation.frais_optionnels_montant ?? 0));
  const declaredOptionalFeesTotal = reservation.frais_optionnels_declares ? optionalFeesTotal : 0;
  const totalSegmentNights = segments.reduce((sum, segment) => sum + segment.nights, 0);
  let allocatedOptionalFees = 0;
  let allocatedDeclaredOptionalFees = 0;

  for (let idx = 0; idx < segments.length; idx += 1) {
    const segment = segments[idx];
    const segmentYear = segment.start.getUTCFullYear();
    const segmentMonth = segment.start.getUTCMonth() + 1;
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

    if (segmentYear === year && segmentMonth === month) {
      const baseRevenue = round2(effectiveNightPrice * segment.nights);
      const totalFees = optionalFeesForSegment;
      const declaredFees = declaredOptionalFeesForSegment;
      const undeclaredFees = round2(Math.max(0, totalFees - declaredFees));
      return {
        baseRevenue,
        totalFees,
        declaredFees,
        undeclaredFees,
        total: round2(baseRevenue + totalFees),
        nights: segment.nights,
      };
    }
  }

  return {
    baseRevenue: 0,
    totalFees: 0,
    declaredFees: 0,
    undeclaredFees: 0,
    total: 0,
    nights: 0,
  };
};
