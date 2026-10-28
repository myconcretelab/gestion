/** Demonstration only: these rules never participate in the application's financial calculations. */
export const REPORT_CATEGORIES = [
  { id: "accommodation", label: "Hébergement" },
  { id: "cleaning", label: "Ménage" },
  { id: "linen", label: "Linge" },
  { id: "extras", label: "Autres prestations" },
  { id: "tourist_tax", label: "Taxe de séjour" },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];
export const REPORT_PROPERTIES = [
  { id: "orchard", name: "La Maison du verger", initials: "MV" },
  { id: "woods", name: "Le Refuge des bois", initials: "RB" },
  { id: "mill", name: "Le Petit Moulin", initials: "PM" },
] as const;
export type ReportKind = "social" | "tourist" | "owner" | "custom";
export type ReportCadence = "monthly" | "quarterly" | "yearly";
export type ReportDefinition = {
  id: string;
  kind: ReportKind;
  name: string;
  description: string;
  recipient: string;
  dateBasis: "payment" | "stay";
  cadence: ReportCadence;
  categories: ReportCategory[];
  propertyIds: string[];
  favorite: boolean;
};
export type ReportOperation = {
  id: string;
  reservation: string;
  guest: string;
  propertyId: string;
  category: ReportCategory;
  amountCents: number;
  nights: number;
  paymentDate: string | null;
  stayDate: string;
  channel: string;
  reviewReason?: string;
};
export type OperationStatus = "included" | "review" | "excluded";
export type OperationOverride = { status: OperationStatus; note: string };
export type EvaluatedOperation = ReportOperation & {
  status: OperationStatus;
  reason: string;
  value: number;
  effectiveDate: string | null;
};
export type ReportResult = {
  rows: EvaluatedOperation[];
  total: number;
  includedCount: number;
  reviewCount: number;
  excludedCount: number;
};
export type ReportSnapshot = {
  confirmedAt: string;
  definition: ReportDefinition;
  result: ReportResult;
};
export type ReportProgress = {
  ready?: boolean;
  snapshot?: ReportSnapshot;
};
export type PrototypeState = {
  version: 1;
  reports: ReportDefinition[];
  drafts: Record<string, ReportDefinition>;
  overrides: Record<string, Record<string, OperationOverride>>;
  progress: Record<string, ReportProgress>;
};

const allProperties = REPORT_PROPERTIES.map((property) => property.id);
const revenueCategories: ReportCategory[] = [
  "accommodation",
  "cleaning",
  "linen",
  "extras",
];
export const REPORT_TEMPLATES: Array<{
  kind: ReportKind;
  name: string;
  description: string;
}> = [
  {
    kind: "social",
    name: "Cotisations sociales",
    description: "Préparer une base de recettes par exploitant.",
  },
  {
    kind: "tourist",
    name: "Nuitées et taxe de séjour",
    description: "Rassembler les nuitées des hébergements concernés.",
  },
  {
    kind: "owner",
    name: "Relevé propriétaire",
    description: "Retrouver les recettes des logements d’un propriétaire.",
  },
  {
    kind: "custom",
    name: "Rapport personnalisé",
    description: "Composer votre propre suivi à partir des recettes.",
  },
];

export function createReport(kind: ReportKind, id: string): ReportDefinition {
  const template = REPORT_TEMPLATES.find((item) => item.kind === kind)!;
  return {
    id,
    kind,
    name: template.name,
    description: template.description,
    recipient:
      kind === "social"
        ? "Exploitant · Exemple"
        : kind === "tourist"
          ? "Collectivité · Exemple"
          : kind === "owner"
            ? "Propriétaire · Exemple"
            : "Mon suivi",
    dateBasis: kind === "tourist" ? "stay" : "payment",
    cadence: "monthly",
    categories:
      kind === "tourist"
        ? ["accommodation"]
        : kind === "custom"
          ? ["cleaning", "linen", "extras"]
          : [...revenueCategories],
    propertyIds: kind === "owner" ? ["orchard"] : [...allProperties],
    favorite: kind === "social",
  };
}

const makeOperation = (
  id: string,
  guest: string,
  propertyId: string,
  category: ReportCategory,
  amountCents: number,
  stayDate: string,
  paymentDate: string | null,
  nights = 0,
  reviewReason?: string,
  channel = "Direct",
): ReportOperation => ({
  id,
  reservation: `EX-${id.split("-")[0]}`,
  guest,
  propertyId,
  category,
  amountCents,
  stayDate,
  paymentDate,
  nights,
  ...(reviewReason ? { reviewReason } : {}),
  channel,
});

export const DEMO_OPERATIONS: ReportOperation[] = [
  makeOperation(
    "101-stay",
    "Camille Martin",
    "orchard",
    "accommodation",
    68000,
    "2026-10-03",
    "2026-10-01",
    8,
  ),
  makeOperation(
    "101-cleaning",
    "Camille Martin",
    "orchard",
    "cleaning",
    6500,
    "2026-10-03",
    "2026-10-01",
  ),
  makeOperation(
    "101-linen",
    "Camille Martin",
    "orchard",
    "linen",
    3000,
    "2026-10-03",
    "2026-10-01",
  ),
  makeOperation(
    "102-stay",
    "Alex Moreau",
    "woods",
    "accommodation",
    92000,
    "2026-10-06",
    "2026-09-28",
    12,
    undefined,
    "Plateforme",
  ),
  makeOperation(
    "102-cleaning",
    "Alex Moreau",
    "woods",
    "cleaning",
    8000,
    "2026-10-06",
    "2026-10-06",
  ),
  makeOperation(
    "103-stay",
    "Lou Bernard",
    "mill",
    "accommodation",
    54000,
    "2026-10-10",
    "2026-10-08",
    6,
  ),
  makeOperation(
    "103-extra",
    "Lou Bernard",
    "mill",
    "extras",
    2500,
    "2026-10-10",
    null,
  ),
  makeOperation(
    "104-stay",
    "Sacha Petit",
    "orchard",
    "accommodation",
    76000,
    "2026-10-14",
    "2026-10-12",
    10,
  ),
  makeOperation(
    "104-tax",
    "Sacha Petit",
    "orchard",
    "tourist_tax",
    1800,
    "2026-10-14",
    "2026-10-12",
  ),
  makeOperation(
    "105-stay",
    "Charlie Dubois",
    "woods",
    "accommodation",
    84000,
    "2026-10-18",
    "2026-10-15",
    12,
    "Le rattachement à l’exploitant reste à confirmer.",
    "Plateforme",
  ),
  makeOperation(
    "105-linen",
    "Charlie Dubois",
    "woods",
    "linen",
    4500,
    "2026-10-18",
    "2026-10-15",
  ),
  makeOperation(
    "106-stay",
    "Noa Laurent",
    "mill",
    "accommodation",
    48000,
    "2026-10-22",
    "2026-10-20",
    6,
  ),
  makeOperation(
    "106-refund",
    "Noa Laurent",
    "mill",
    "extras",
    -3500,
    "2026-10-22",
    "2026-10-23",
  ),
  makeOperation(
    "107-stay",
    "Alix Robert",
    "orchard",
    "accommodation",
    59000,
    "2026-11-02",
    "2026-10-25",
    8,
  ),
  makeOperation(
    "108-stay",
    "Morgan Richard",
    "woods",
    "accommodation",
    72000,
    "2026-11-08",
    "2026-11-01",
    10,
  ),
  makeOperation(
    "109-stay",
    "Robin Simon",
    "mill",
    "accommodation",
    46000,
    "2026-09-18",
    "2026-09-12",
    6,
  ),
];

export const categoryLabel = (id: ReportCategory) =>
  REPORT_CATEGORIES.find((category) => category.id === id)!.label;
export const propertyName = (id: string) =>
  REPORT_PROPERTIES.find((property) => property.id === id)?.name ?? id;
export const cadenceLabel = (cadence: ReportCadence) =>
  ({ monthly: "Mensuel", quarterly: "Trimestriel", yearly: "Annuel" })[cadence];

export function getReportPeriod(month: string, cadence: ReportCadence) {
  const [year, monthNumber] = month.split("-").map(Number);
  const startMonth =
    cadence === "yearly"
      ? 1
      : cadence === "quarterly"
        ? Math.floor((monthNumber - 1) / 3) * 3 + 1
        : monthNumber;
  const length = cadence === "yearly" ? 12 : cadence === "quarterly" ? 3 : 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, startMonth - 1 + length, 1));
  const end = endDate.toISOString().slice(0, 10);
  const label =
    cadence === "yearly"
      ? String(year)
      : cadence === "quarterly"
        ? `${Math.floor((monthNumber - 1) / 3) + 1}ᵉ trimestre ${year}`
        : new Intl.DateTimeFormat("fr-FR", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${start}T12:00:00Z`));
  return { start, end, label, key: `${start}:${cadence}` };
}

export const reportPeriodKey = (report: ReportDefinition, month: string) =>
  `${report.id}:${getReportPeriod(month, report.cadence).key}`;

export function evaluateReport(
  report: ReportDefinition,
  month: string,
  overrides: Record<string, OperationOverride> = {},
  operations = DEMO_OPERATIONS,
): ReportResult {
  const period = getReportPeriod(month, report.cadence);
  const rows: EvaluatedOperation[] = [];
  for (const operation of operations) {
    const effectiveDate =
      report.dateBasis === "payment"
        ? operation.paymentDate
        : operation.stayDate;
    // A missing payment date is surfaced in its stay period; it never enters the total automatically.
    const candidateDate = effectiveDate ?? operation.stayDate;
    if (candidateDate < period.start || candidateDate >= period.end) continue;
    const inProperty = report.propertyIds.includes(operation.propertyId);
    const inCategory = report.categories.includes(operation.category);
    let status: OperationStatus =
      !inProperty || !inCategory
        ? "excluded"
        : !effectiveDate || operation.reviewReason
          ? "review"
          : "included";
    let reason = !inProperty
      ? "Ce logement ne fait pas partie du périmètre."
      : !inCategory
        ? "Cette catégorie ne fait pas partie du périmètre."
        : !effectiveDate
          ? "La date d’encaissement est manquante."
          : (operation.reviewReason ??
            `Inclus selon la catégorie « ${categoryLabel(operation.category)} » et le logement.`);
    const override = overrides[operation.id];
    if (override) {
      status = override.status;
      reason = `Correction pour ce rapport : ${override.note}`;
    }
    const value =
      report.kind === "tourist" ? operation.nights : operation.amountCents;
    rows.push({ ...operation, status, reason, value, effectiveDate });
  }
  rows.sort(
    (a, b) =>
      (b.effectiveDate ?? b.stayDate).localeCompare(
        a.effectiveDate ?? a.stayDate,
      ) || a.id.localeCompare(b.id),
  );
  return {
    rows,
    total: rows.reduce(
      (total, row) => total + (row.status === "included" ? row.value : 0),
      0,
    ),
    includedCount: rows.filter((row) => row.status === "included").length,
    reviewCount: rows.filter((row) => row.status === "review").length,
    excludedCount: rows.filter((row) => row.status === "excluded").length,
  };
}

export function createPrototypeState(): PrototypeState {
  return {
    version: 1,
    reports: REPORT_TEMPLATES.map((template) =>
      createReport(template.kind, `demo-${template.kind}`),
    ),
    drafts: {},
    overrides: {},
    progress: {},
  };
}

export const formatReportValue = (
  report: Pick<ReportDefinition, "kind">,
  value: number,
) =>
  report.kind === "tourist"
    ? `${value.toLocaleString("fr-FR")} nuitée${Math.abs(value) === 1 ? "" : "s"}`
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(value / 100);

export function snapshotDiffers(
  snapshot: ReportSnapshot,
  result: ReportResult,
) {
  const signature = (value: ReportResult) =>
    JSON.stringify(
      value.rows.map((row) => [
        row.id,
        row.status,
        row.value,
        row.effectiveDate,
        row.reason,
      ]),
    );
  return signature(snapshot.result) !== signature(result);
}

export function reportStatus(
  progress: ReportProgress | undefined,
  result: ReportResult,
) {
  if (progress?.snapshot)
    return snapshotDiffers(progress.snapshot, result)
      ? "Écart à examiner"
      : "Transmission confirmée";
  if (result.reviewCount) return `${result.reviewCount} à vérifier`;
  if (progress?.ready) return "Prêt";
  return "À préparer";
}

export function reportCsv(report: ReportDefinition, result: ReportResult) {
  const quote = (value: string | number) => {
    const text =
      typeof value === "number" ? String(value).replace(".", ",") : value;
    // Keep names, labels and free-form notes from becoming spreadsheet formulas.
    const safe =
      typeof value === "string" && /^[\s]*[=+@-]/.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const headers = [
    "Réservation d’exemple",
    "Voyageur fictif",
    "Logement fictif",
    "Catégorie",
    "Date retenue",
    report.kind === "tourist" ? "Nuitées" : "Montant EUR",
    "Traitement",
    "Explication",
  ];
  const labels = {
    included: "Inclus",
    review: "À vérifier",
    excluded: "Hors périmètre",
  };
  return (
    "\uFEFF" +
    [
      headers,
      ...result.rows.map((row) => [
        row.reservation,
        row.guest,
        propertyName(row.propertyId),
        categoryLabel(row.category),
        row.effectiveDate ?? "À vérifier",
        report.kind === "tourist" ? row.value : row.value / 100,
        labels[row.status],
        row.reason,
      ]),
    ]
      .map((row) => row.map(quote).join(";"))
      .join("\r\n")
  );
}
