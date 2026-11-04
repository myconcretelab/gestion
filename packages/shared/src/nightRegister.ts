import { z } from "zod";

export const NIGHT_REGISTER_LEGAL_URL =
  "https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000053544103/2026-05-10";

export type NightRegisterRow = {
  key: string;
  collectionId?: string;
  collectionReservationIds?: string[];
  allocationProposal?: {
    collectionDate: string;
    collectedTaxCents: number;
    collectedBaseTaxCents: number;
    additionalTaxes: string;
    explanation: string;
  };
  allocationUnavailableReason?: string;
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
  taxableAdults: number | null;
  exemptAdults: number | null;
  children: number;
  infants: number | null;
  occupants: number | null;
  nights: number;
  personNights: number | null;
  classified: boolean | null;
  nightlyPriceCents: number | null;
  nightlyPrices?: Array<{ date: string; amountCents: number }>;
  collectedTaxCents: number | null;
  observedCollectionCents: number | null;
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
  sourceRevision: string;
  archivedAt?: string;
  completion?: NightRegisterCompletion;
  summary: NightDeclarationSummary[];
  reportNights: number;
  stayCount: number;
  incompleteCount: number;
  properties: Array<{
    id: string;
    name: string;
    address: string;
    registrationNumber: string | null;
    portalReference?: string | null;
    declarationReceiptReference?: string | null;
  }>;
  rows: NightRegisterRow[];
};

const amount = z.number().int().min(0).max(1_000_000_000).nullable();
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  )
  .nullable();
export const nightRegisterCompletionSchema = z
  .object({
    sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(3).max(1000),
    rows: z
      .record(
        z.string().min(1).max(200),
        z
          .object({
            collectionDate: date,
            collectedTaxCents: amount,
            collectedBaseTaxCents: amount,
            additionalTaxes: z.string().trim().max(1000),
            nightlyPriceCents: amount,
            nightlyPrices: z
              .array(
                z
                  .object({ date: date.unwrap(), amountCents: amount.unwrap() })
                  .strict(),
              )
              .max(3660)
              .optional(),
            allocationReviewed: z.boolean(),
          })
          .strict()
          .refine(
            (row) =>
              row.collectedBaseTaxCents === null ||
              row.collectedTaxCents === null ||
              row.collectedBaseTaxCents <= row.collectedTaxCents,
            "La part hors taxes additionnelles dépasse le total collecté.",
          ),
      )
      .refine((rows) => Object.keys(rows).length <= 10000),
  })
  .strict();
export type NightRegisterCompletion = z.infer<
  typeof nightRegisterCompletionSchema
>;

export type NightDeclarationSummary = {
  propertyId: string;
  propertyName: string;
  stays: number;
  personNights: number | null;
  taxablePersonNights: number | null;
  exemptMinorPersonNights: number | null;
  exemptAdultPersonNights: number | null;
  nonApplicablePersonNights: number | null;
  hostCollectedCents: number | null;
  platformCollectedCents: number | null;
  baseCollectedCents: number | null;
  additionalCollectedCents: number | null;
  incompleteStays: number;
};

/** Count each stay once, but every identified perception. Unknowns never become zero. */
export function summarizeNightRegister(
  register: Pick<NightRegister, "properties" | "rows">,
): NightDeclarationSummary[] {
  const sum = (values: (number | null)[]) =>
    values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + value!, 0);
  return register.properties.map((property) => {
    const rows = register.rows.filter((row) => row.propertyId === property.id);
    const stays = [
      ...new Map(rows.map((row) => [row.reservationId, row])).values(),
    ];
    const applicable = stays.filter(
      (row) => row.collector !== "not_applicable",
    );
    const collected = rows.filter(
      (row) => row.collector === "host" || row.collector === "platform",
    );
    return {
      propertyId: property.id,
      propertyName: property.name,
      stays: stays.length,
      personNights: sum(stays.map((row) => row.personNights)),
      taxablePersonNights: sum(
        applicable.map((row) =>
          row.taxableAdults === null ? null : row.taxableAdults * row.nights,
        ),
      ),
      exemptMinorPersonNights: sum(
        applicable.map((row) =>
          row.infants === null
            ? null
            : (row.children + row.infants) * row.nights,
        ),
      ),
      exemptAdultPersonNights: sum(
        applicable.map((row) =>
          row.exemptAdults === null ? null : row.exemptAdults * row.nights,
        ),
      ),
      nonApplicablePersonNights: sum(
        stays
          .filter((row) => row.collector === "not_applicable")
          .map((row) => row.personNights),
      ),
      hostCollectedCents: rows.some((row) => row.collector === "unknown")
        ? null
        : sum(
            rows
              .filter((row) => row.collector === "host")
              .map((row) => row.collectedTaxCents),
          ),
      platformCollectedCents: rows.some((row) => row.collector === "unknown")
        ? null
        : sum(
            rows
              .filter((row) => row.collector === "platform")
              .map((row) => row.collectedTaxCents),
          ),
      baseCollectedCents: rows.some((row) => row.collector === "unknown")
        ? null
        : sum(collected.map((row) => row.collectedBaseTaxCents)),
      additionalCollectedCents: rows.some((row) => row.collector === "unknown")
        ? null
        : sum(
            collected.map((row) =>
              row.collectedBaseTaxCents === null ||
              row.collectedTaxCents === null
                ? null
                : row.collectedTaxCents - row.collectedBaseTaxCents,
            ),
          ),
      incompleteStays: stays.filter((stay) =>
        rows.some(
          (row) =>
            row.reservationId === stay.reservationId && row.issues.length,
        ),
      ).length,
    };
  });
}

const euro = (value: number | null) =>
  value === null ? "À compléter" : (value / 100).toFixed(2).replace(".", ",");
export function nightDeclarationCsv(register: NightRegister) {
  const rows = [
    [
      "Période",
      "Gîte",
      "Séjours",
      "Nuitées personnes",
      "Nuitées taxables",
      "Nuitées mineurs exonérés",
      "Nuitées adultes exonérés",
      "Nuitées hors application",
      "Taxe collectée hébergeur (EUR)",
      "Taxe collectée plateformes (EUR)",
      "Part hors taxes additionnelles (EUR)",
      "Taxes additionnelles (EUR)",
      "Séjours à compléter",
      "Référence du portail de déclaration",
      "Numéro d’enregistrement (si applicable)",
      "Référence du récépissé de déclaration en mairie",
    ],
    ...register.summary.map((row) => [
      register.period.label,
      row.propertyName,
      row.stays,
      row.personNights ?? "À compléter",
      row.taxablePersonNights ?? "À compléter",
      row.exemptMinorPersonNights ?? "À compléter",
      row.exemptAdultPersonNights ?? "À compléter",
      row.nonApplicablePersonNights ?? "À compléter",
      euro(row.hostCollectedCents),
      euro(row.platformCollectedCents),
      euro(row.baseCollectedCents),
      euro(row.additionalCollectedCents),
      row.incompleteStays,
      register.properties.find((property) => property.id === row.propertyId)
        ?.portalReference ?? "",
      register.properties.find((property) => property.id === row.propertyId)
        ?.registrationNumber ?? "À compléter si applicable",
      register.properties.find((property) => property.id === row.propertyId)
        ?.declarationReceiptReference ?? "",
    ]),
  ];
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            return `"${(/^\s*[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
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
    "Adultes taxables",
    "Adultes exonérés",
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
    "Référence du portail de déclaration",
    "Référence du récépissé de déclaration en mairie",
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
          (row.collector === "not_applicable" || row.collectedTaxCents === 0
            ? "Sans perception"
            : "À compléter"),
        row.adults,
        row.taxableAdults ?? "À compléter",
        row.exemptAdults ?? "À compléter",
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
        row.classified
          ? "Sans objet"
          : row.nightlyPrices?.length
            ? row.nightlyPrices
                .map((night) => `${night.date} : ${euro(night.amountCents)}`)
                .join(" ; ")
            : euro(row.nightlyPriceCents),
        euro(row.collectedBaseTaxCents),
        euro(row.collectedTaxCents),
        euro(row.calculatedStayTaxCents),
        row.additionalTaxes ?? "À compléter si applicable",
        row.exemptionReason ?? "À compléter",
        row.source,
        row.issues.join(" · "),
        register.properties.find((property) => property.id === row.propertyId)
          ?.portalReference ?? "",
        register.properties.find((property) => property.id === row.propertyId)
          ?.declarationReceiptReference ?? "",
      ]),
    ]
      .map((row) => row.map(quote).join(";"))
      .join("\r\n")
  );
}
