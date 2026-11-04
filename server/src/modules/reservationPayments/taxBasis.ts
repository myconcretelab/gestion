import { getBookingSource, type NightTaxSegment } from "@contrats/shared";
import { fromJsonString } from "../../utils/jsonFields.js";

export const nightTaxSegments = (
  rows: Array<{
    id: string;
    gite_id: string | null;
    date_entree: Date;
    date_sortie: Date;
    nb_nuits: number;
    nb_adultes: number;
    nb_enfants_2_17: number;
    options: unknown;
    booking_source: string | null;
    source_paiement: string | null;
  }>,
): NightTaxSegment[] =>
  rows.map((row) => ({
    id: row.id,
    propertyId: row.gite_id,
    arrival: row.date_entree.toISOString().slice(0, 10),
    departure: row.date_sortie.toISOString().slice(0, 10),
    nights: row.nb_nuits,
    adults: row.nb_adultes,
    children: row.nb_enfants_2_17,
    source: getBookingSource(row),
    touristTax: fromJsonString<{ tourist_tax?: unknown }>(row.options, {})
      .tourist_tax,
  }));
