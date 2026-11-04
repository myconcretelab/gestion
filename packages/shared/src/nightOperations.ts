import { getBookingSource } from "./reservationPayments.js";
import type { ReportOperation } from "./reports.js";
import { touristTaxStaySchema } from "./touristTax.js";

export const NIGHT_GUEST_GROUPS = [
  { id: "adults", label: "Adultes" },
  { id: "children", label: "Enfants" },
  { id: "infants", label: "Bébés" },
] as const;
export type NightGuestGroup = (typeof NIGHT_GUEST_GROUPS)[number]["id"];
export const nightGuestGroupsLabel = (
  groups: NightGuestGroup[] = ["adults"],
) =>
  groups.length === 1 && groups[0] === "adults"
    ? "Adultes uniquement"
    : NIGHT_GUEST_GROUPS.filter((group) => groups.includes(group.id))
        .map((group) => group.label)
        .join(", ");
export const reportNightValue = (
  operation: Pick<ReportOperation, "nights" | "nightCounts">,
  groups: NightGuestGroup[] = ["adults"],
) =>
  operation.nightCounts
    ? groups.reduce((sum, group) => sum + operation.nightCounts![group], 0)
    : operation.nights;

export type NightReservation = {
  id: string;
  gite_id?: string | null;
  hote_nom: string;
  date_entree: Date | string;
  date_sortie: Date | string;
  nb_adultes: number;
  nb_enfants_2_17?: number;
  infants?: number;
  tourist_tax?: unknown;
  booking_source?: string | null;
  source_paiement?: string | null;
};
const count = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
/** Calendar nights shared by the report and its lightweight monthly summary. No payments. */
export function buildNightOperations(
  reservations: NightReservation[],
): ReportOperation[] {
  return reservations.flatMap((reservation) => {
    let start = Date.parse(
      new Date(reservation.date_entree).toISOString().slice(0, 10),
    );
    const end = Date.parse(
      new Date(reservation.date_sortie).toISOString().slice(0, 10),
    );
    const operations: ReportOperation[] = [];
    const tax = touristTaxStaySchema.safeParse(reservation.tourist_tax);
    const taxIssue = !tax.success
      ? "Barème, collecteur et exonérations du séjour à renseigner."
      : tax.data.collector === "unknown"
        ? "Collecteur de la taxe de séjour à renseigner."
        : tax.data.exempt_adults > reservation.nb_adultes
          ? "Le nombre d’adultes exonérés dépasse le nombre d’adultes."
          : (tax.data.exempt_adults > 0 ||
                tax.data.collector === "not_applicable") &&
              !tax.data.exemption_reason
            ? "Motif d’exonération ou de non-application à renseigner."
            : tax.data.collector === "platform" && !tax.data.platform
              ? "Plateforme collectrice à renseigner."
              : new Date(reservation.date_entree).toISOString().slice(0, 10) <
                  tax.data.settings.effective_from
                ? "Le séjour commence avant la date d’application du barème."
                : undefined;
    while (start < end) {
      const date = new Date(start);
      const next = Math.min(
        end,
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      );
      const nights = Math.round((next - start) / 86400000);
      const stayDate = date.toISOString().slice(0, 10);
      const nightCounts = {
        adults: nights * count(reservation.nb_adultes),
        children: nights * count(reservation.nb_enfants_2_17),
        infants: nights * count(reservation.infants),
      };
      operations.push({
        id: `night:${reservation.id}:${stayDate.slice(0, 7)}`,
        reservation: reservation.id,
        reservationId: reservation.id,
        guest: reservation.hote_nom,
        propertyId: reservation.gite_id ?? "unassigned",
        category: "accommodation",
        amountCents: 0,
        nights: nightCounts.adults,
        nightCounts,
        taxableNights:
          tax.success && !taxIssue
            ? nights *
              (tax.data.collector === "not_applicable"
                ? 0
                : Math.max(
                    0,
                    count(reservation.nb_adultes) - tax.data.exempt_adults,
                  ))
            : null,
        nightTaxIssue: taxIssue,
        stayDate,
        paymentDate: null,
        channel: getBookingSource(reservation),
        bookingSource: getBookingSource(reservation),
        paymentMethod: "unknown",
        basis: "nights",
      });
      start = next;
    }
    return operations;
  });
}

export type NightSummaryResponse = {
  year: number;
  report: { id: string; name: string; guestGroups: NightGuestGroup[] } | null;
  calculatedAt: string;
  properties: Array<{
    id: string;
    inScope: boolean;
    months: Array<{
      month: number;
      total: number;
      included: number;
      reviewCount: number;
    }>;
  }>;
};
