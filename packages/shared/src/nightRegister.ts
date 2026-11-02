export const NIGHT_REGISTER_LEGAL_URL =
  "https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000053544103/2026-05-10";

export type NightRegisterRow = {
  reference: string;
  reservationId: string;
  propertyId: string;
  propertyName: string;
  address: string;
  registrationNumber: string | null;
  arrival: string;
  departure: string;
  periodStart: string;
  periodEnd: string;
  collectionDate: string | null;
  collector: "unknown" | "host" | "platform" | "not_applicable";
  adults: number;
  children: number;
  infants: number | null;
  occupants: number | null;
  nights: number;
  personNights: number | null;
  classified: boolean | null;
  nightlyPriceCents: number | null;
  collectedTaxCents: number | null;
  collectedBaseTaxCents: number | null;
  calculatedStayTaxCents: number | null;
  additionalTaxes: string | null;
  exemptionReason: string | null;
  source: string;
  issues: string[];
};
export type NightRegister = {
  reportId: string;
  reportName: string;
  recipient: string;
  period: { label: string; start: string; end: string };
  generatedAt: string;
  revision: string;
  reportNights: number;
  stayCount: number;
  incompleteCount: number;
  properties: Array<{
    id: string;
    name: string;
    address: string;
    registrationNumber: string | null;
  }>;
  rows: NightRegisterRow[];
};

const euro = (value: number | null) =>
  value === null ? "À compléter" : (value / 100).toFixed(2).replace(".", ",");
export function nightRegisterCsv(register: NightRegister) {
  const quote = (value: string | number) => {
    const text = String(value);
    return `"${(/^\s*[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };
  const headings = [
    "Référence",
    "Gîte",
    "Adresse de l’hébergement",
    "Numéro d’enregistrement (si applicable)",
    "Début du séjour",
    "Fin du séjour",
    "Début dans la période",
    "Fin dans la période (exclue)",
    "Date de perception",
    "Adultes",
    "Enfants",
    "Bébés",
    "Personnes ayant séjourné",
    "Nuits dans la période",
    "Nuitées personnes dans la période",
    "Hébergement classé",
    "Prix de chaque nuitée hors taxe de séjour (EUR, si non classé)",
    "Taxe de séjour collectée hors taxes additionnelles (EUR)",
    "Total collecté taxes additionnelles comprises affecté à la période (EUR)",
    "Taxe calculée pour le séjour complet (EUR, ne vaut pas perception)",
    "Détail des taxes additionnelles",
    "Motifs d’exonération",
    "Source",
    "Informations à compléter",
  ];
  return (
    "\uFEFF" +
    [
      headings,
      ...register.rows.map((row) => [
        row.reference,
        row.propertyName,
        row.address || "À compléter",
        row.registrationNumber ?? "À compléter si applicable",
        row.arrival,
        row.departure,
        row.periodStart,
        row.periodEnd,
        row.collectionDate ??
          (row.collector === "not_applicable"
            ? "Sans perception"
            : "À compléter"),
        row.adults,
        row.children,
        row.infants ?? "À compléter",
        row.occupants ?? "À compléter",
        row.nights,
        row.personNights ?? "À compléter",
        row.classified === null
          ? "À compléter"
          : row.classified
            ? "Oui"
            : "Non",
        row.classified ? "Sans objet" : euro(row.nightlyPriceCents),
        euro(row.collectedBaseTaxCents),
        euro(row.collectedTaxCents),
        euro(row.calculatedStayTaxCents),
        row.additionalTaxes ?? "À compléter si applicable",
        row.exemptionReason ?? "À compléter",
        row.source,
        row.issues.join(" · "),
      ]),
    ]
      .map((row) => row.map(quote).join(";"))
      .join("\r\n")
  );
}
