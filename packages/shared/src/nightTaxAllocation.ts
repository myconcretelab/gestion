import {
  computeTouristTax,
  touristTaxStaySchema,
  type TouristTaxResult,
} from "./touristTax.js";

export type NightTaxSegment = {
  id: string;
  propertyId: string | null;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  source?: string;
  touristTax: unknown;
};
export type NightTaxSlice = {
  reservationId: string;
  start: string;
  end: string;
  baseCents: number;
  additionalCents: number;
};
export type NightTaxBasis = {
  reason: string | null;
  additionalPercentage: number;
  slices: NightTaxSlice[];
};
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
// Integer remainders keep the last cent exact even when amount × weight exceeds 2^53.
const allocate = (amount: number, weights: number[]) => {
  const total = weights.reduce((sum, value) => sum + BigInt(value), 0n);
  if (!total) return weights.map(() => 0);
  const products = weights.map((value) => BigInt(amount) * BigInt(value));
  const shares = products.map((value) => Number(value / total));
  const order = products
    .map((value, index) => ({ index, remainder: value % total }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const left = amount - sum(shares);
  for (let index = 0; index < left; index++) shares[order[index].index]++;
  return shares;
};

/** A common frozen rate can be apportioned; heterogeneous or overlapping stays require evidence. */
export function buildNightTaxBasis(
  segments: NightTaxSegment[],
  tax: TouristTaxResult | null,
): NightTaxBasis {
  const fail = (reason: string): NightTaxBasis => ({
    reason,
    additionalPercentage: 0,
    slices: [],
  });
  const rows = [...segments].sort(
    (a, b) => a.arrival.localeCompare(b.arrival) || a.id.localeCompare(b.id),
  );
  const first = rows[0];
  const parsed = touristTaxStaySchema.safeParse(first?.touristTax);
  if (
    !first ||
    !parsed.success ||
    !tax ||
    tax.issues.length ||
    tax.collector !== "host"
  )
    return fail(
      "Un barème valide et une collecte par l’hébergeur sont nécessaires pour proposer la ventilation.",
    );
  const stay = parsed.data;
  if (stay.collector !== "host")
    return fail("La collecte n’est pas enregistrée au nom de l’hébergeur.");
  const signature = (value: typeof stay) =>
    JSON.stringify([
      value.settings,
      value.collector,
      value.platform,
      value.infants,
      value.exempt_adults,
      value.exemption_reason,
    ]);
  for (const [index, row] of rows.entries()) {
    const checked = touristTaxStaySchema.safeParse(row.touristTax);
    const duration =
      (Date.parse(row.departure) - Date.parse(row.arrival)) / 86400000;
    if (
      !row.propertyId ||
      !Number.isInteger(duration) ||
      duration <= 0 ||
      duration !== row.nights
    )
      return fail(
        "Les dates, les nuits et le logement de chaque partie du séjour doivent être cohérents.",
      );
    if (
      !checked.success ||
      signature(checked.data) !== signature(stay) ||
      row.adults !== first.adults ||
      row.children !== first.children ||
      row.source !== first.source
    )
      return fail(
        "Les parties du séjour n’ont pas les mêmes occupants, exonérations ou barèmes enregistrés. Vérifiez leur ventilation sur justificatifs.",
      );
    if (index && rows[index - 1].departure > row.arrival)
      return fail(
        "Les hébergements du groupe se chevauchent. La répartition des personnes et de la taxe doit être vérifiée sur justificatifs.",
      );
  }
  if (rows.length > 1 && !stay.settings.classified)
    return fail(
      "Le prix de chaque nuit du séjour regroupé non classé doit être vérifié avant de ventiler la taxe.",
    );
  const nights = sum(rows.map((row) => row.nights));
  if (
    tax.nights !== nights ||
    tax.taxable_adults !== Math.max(0, first.adults - stay.exempt_adults)
  )
    return fail(
      "Les nuitées taxables ne correspondent plus au calcul de taxe enregistré.",
    );
  const base = computeTouristTax({
    stay: {
      ...stay,
      settings: { ...stay.settings, included: false, additional_percentage: 0 },
    },
    nights,
    adults: first.adults,
    children: first.children,
    accommodation: tax.accommodation_amount,
    start: first.arrival,
  });
  const unitBase = cents(base.unit_amount),
    unitAdditional = cents(
      (unitBase * stay.settings.additional_percentage) / 10000,
    );
  if (
    base.issues.length ||
    unitBase + unitAdditional !== cents(tax.unit_amount) ||
    cents(tax.amount) !==
      (unitBase + unitAdditional) * nights * tax.taxable_adults
  )
    return fail(
      "Les montants enregistrés ne permettent pas une ventilation exacte de la taxe et de ses arrondis.",
    );
  const slices: NightTaxSlice[] = [];
  for (const row of rows) {
    let cursor = Date.parse(row.arrival);
    const end = Date.parse(row.departure);
    while (cursor < end) {
      const date = new Date(cursor);
      const next = Math.min(
        end,
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      );
      const count = ((next - cursor) / 86400000) * tax.taxable_adults;
      slices.push({
        reservationId: row.id,
        start: day(cursor),
        end: day(next),
        baseCents: unitBase * count,
        additionalCents: unitAdditional * count,
      });
      cursor = next;
    }
  }
  return {
    reason: null,
    additionalPercentage: stay.settings.additional_percentage,
    slices,
  };
}

export type NightTaxCollection = {
  id: string;
  amountCents: number;
  paidOn: string | null;
  needsReview: boolean;
};
/** Reserve every cent across the whole stay before selecting a report, property or period. */
export function allocateNightTaxCollections(
  basis: NightTaxBasis,
  collections: NightTaxCollection[],
) {
  const allocations = new Map<string, NightTaxSlice[]>();
  if (basis.reason) return { reason: basis.reason, allocations };
  const ordered = [...collections].sort(
    (a, b) =>
      (a.paidOn ?? "9999").localeCompare(b.paidOn ?? "9999") ||
      a.id.localeCompare(b.id),
  );
  const remaining = basis.slices.flatMap((slice) => [
    slice.baseCents,
    slice.additionalCents,
  ]);
  if (
    remaining.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Number.isSafeInteger(sum(remaining)) ||
    ordered.some(
      (row) =>
        row.needsReview ||
        !Number.isSafeInteger(row.amountCents) ||
        row.amountCents < 0,
    ) ||
    sum(ordered.map((row) => row.amountCents)) > sum(remaining)
  )
    return {
      reason:
        "Les perceptions dépassent la taxe calculée ou nécessitent une vérification. Corrigez les règlements avant de proposer une ventilation.",
      allocations,
    };
  for (const collection of ordered) {
    const parts = allocate(collection.amountCents, remaining);
    parts.forEach((amount, index) => {
      remaining[index] -= amount;
    });
    allocations.set(
      collection.id,
      basis.slices.map((slice, index) => ({
        ...slice,
        baseCents: parts[index * 2],
        additionalCents: parts[index * 2 + 1],
      })),
    );
  }
  return { reason: null, allocations };
}

export const isNightCollectionKey = (key: string, collectionId: string) =>
  key === collectionId || key.startsWith(`${collectionId}:stay:`);
