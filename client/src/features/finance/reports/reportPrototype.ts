/** Demonstration only: these rules never participate in the application's financial calculations. */
export const REPORT_CATEGORIES = [
  { id: "accommodation", label: "Hébergement" },
  { id: "cleaning", label: "Ménage" },
  { id: "linen", label: "Linge" },
  { id: "extras", label: "Autres prestations" },
  { id: "tourist_tax", label: "Taxe de séjour" },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];
export const REPORT_PAYMENT_METHODS = [
  { id: "transfer", label: "Virement" },
  { id: "cheque", label: "Chèque" },
  { id: "cash", label: "Espèces" },
  { id: "card", label: "Carte bancaire" },
  { id: "unknown", label: "Non renseigné" },
] as const;
export type ReportPaymentMethod = (typeof REPORT_PAYMENT_METHODS)[number]["id"];
export const REPORT_OPERATORS = [
  { id: "operator-a", name: "Entreprise A · Exemple" },
  { id: "operator-b", name: "Entreprise B · Exemple" },
] as const;
export const DEFAULT_PROPERTY_OPERATORS: Record<string, string | null> = {
  orchard: "operator-a",
  woods: null,
  mill: "operator-b",
};
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
  accommodationPaymentMethods: ReportPaymentMethod[];
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
  paymentMethod: ReportPaymentMethod;
  reviewReason?: string;
};
export type OperationStatus = "included" | "review" | "excluded";
export type OperationOverride = { status: OperationStatus; note: string };
export type ReportIssue = {
  kind: "operator" | "payment";
  message: string;
  actionLabel: string;
};
export type ReportSources = {
  propertyOperators: Record<string, string | null>;
  operationEdits: Record<
    string,
    { paymentDate?: string; paymentMethod?: ReportPaymentMethod }
  >;
};
export type EvaluatedOperation = ReportOperation & {
  issues: ReportIssue[];
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
export type PrototypeState = ReportSources & {
  version: 2;
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
    description: "Recettes de l’exploitant.",
  },
  {
    kind: "tourist",
    name: "Nuitées et taxe de séjour",
    description: "Nuitées par logement.",
  },
  {
    kind: "owner",
    name: "Relevé propriétaire",
    description: "Recettes des logements du propriétaire.",
  },
  {
    kind: "custom",
    name: "Rapport personnalisé",
    description: "Recettes des catégories sélectionnées.",
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
    accommodationPaymentMethods: REPORT_PAYMENT_METHODS.map(
      (method) => method.id,
    ),
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
  paymentMethod:
    (
      {
        "101": "transfer",
        "102": "transfer",
        "103": "cheque",
        "104": "card",
        "105": "transfer",
        "106": "cash",
        "107": "transfer",
        "108": "card",
        "109": "cheque",
      } as Record<string, ReportPaymentMethod>
    )[id.split("-")[0]] ?? "unknown",
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
    undefined,
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
export const paymentMethodLabel = (id: ReportPaymentMethod) =>
  REPORT_PAYMENT_METHODS.find((method) => method.id === id)!.label;
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
  sources: ReportSources = {
    propertyOperators: DEFAULT_PROPERTY_OPERATORS,
    operationEdits: {},
  },
): ReportResult {
  const period = getReportPeriod(month, report.cadence);
  const rows: EvaluatedOperation[] = [];
  for (const original of operations) {
    const operation = { ...original, ...sources.operationEdits[original.id] };
    const effectiveDate =
      report.dateBasis === "payment"
        ? operation.paymentDate
        : operation.stayDate;
    // A missing payment date is surfaced in its stay period; it never enters the total automatically.
    const candidateDate = effectiveDate ?? operation.stayDate;
    if (candidateDate < period.start || candidateDate >= period.end) continue;
    const inProperty = report.propertyIds.includes(operation.propertyId);
    const inCategory = report.categories.includes(operation.category);
    const inPaymentMethod =
      report.kind === "tourist" ||
      operation.category !== "accommodation" ||
      report.accommodationPaymentMethods.includes(operation.paymentMethod);
    const override = overrides[operation.id];
    const issues: ReportIssue[] = [];
    if (
      (inProperty && inCategory && inPaymentMethod) ||
      override?.status === "included"
    ) {
      if (
        report.kind === "social" &&
        !sources.propertyOperators[operation.propertyId]
      )
        issues.push({
          kind: "operator",
          message: `${propertyName(operation.propertyId)} : aucun exploitant rattaché.`,
          actionLabel: "Rattacher le gîte",
        });
      if (!effectiveDate)
        issues.push({
          kind: "payment",
          message: "Date d’encaissement manquante.",
          actionLabel: "Renseigner l’encaissement",
        });
      if (
        report.kind !== "tourist" &&
        operation.category === "accommodation" &&
        operation.paymentMethod === "unknown"
      )
        issues.push({
          kind: "payment",
          message: "Mode de paiement manquant.",
          actionLabel: "Renseigner l’encaissement",
        });
    }
    let status: OperationStatus =
      !inProperty || !inCategory || !inPaymentMethod
        ? "excluded"
        : issues.length
          ? "review"
          : "included";
    let reason = !inProperty
      ? "Ce logement ne fait pas partie du périmètre."
      : !inCategory
        ? "Cette catégorie ne fait pas partie du périmètre."
        : !inPaymentMethod
          ? `Mode de paiement non sélectionné pour l’hébergement : ${paymentMethodLabel(operation.paymentMethod)}.`
          : issues.length
            ? issues.map((issue) => issue.message).join(" ")
            : `Logement et catégorie inclus dans le rapport${operation.category === "accommodation" && report.kind !== "tourist" ? ` · ${paymentMethodLabel(operation.paymentMethod)}` : ""}.`;
    if (override) {
      status =
        override.status === "included" && issues.length
          ? "review"
          : override.status;
      reason =
        status === "review" && issues.length
          ? issues.map((issue) => issue.message).join(" ")
          : `Correction pour ce rapport : ${override.note}`;
    }
    const value =
      report.kind === "tourist" ? operation.nights : operation.amountCents;
    rows.push({ ...operation, status, reason, value, effectiveDate, issues });
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
    version: 2,
    propertyOperators: { ...DEFAULT_PROPERTY_OPERATORS },
    operationEdits: {},
    reports: REPORT_TEMPLATES.map((template) =>
      createReport(template.kind, `demo-${template.kind}`),
    ),
    drafts: {},
    overrides: {},
    progress: {},
  };
}

export function evaluatePrototypeReport(
  state: PrototypeState,
  report: ReportDefinition,
  month: string,
) {
  return evaluateReport(
    report,
    month,
    state.overrides[reportPeriodKey(report, month)],
    undefined,
    state,
  );
}

export function accommodationBreakdown(result: ReportResult) {
  return REPORT_PAYMENT_METHODS.map((method) => {
    const rows = result.rows.filter(
      (row) =>
        row.status === "included" &&
        row.category === "accommodation" &&
        row.paymentMethod === method.id,
    );
    return {
      ...method,
      count: rows.length,
      total: rows.reduce((sum, row) => sum + row.value, 0),
    };
  }).filter((group) => group.count > 0);
}

export function applySourceCorrection(
  state: PrototypeState,
  correction:
    | { kind: "operator"; propertyId: string; operatorId: string }
    | {
        kind: "payment";
        operationId: string;
        paymentDate: string;
        paymentMethod: ReportPaymentMethod;
      },
): PrototypeState {
  return {
    ...state,
    propertyOperators:
      correction.kind === "operator"
        ? {
            ...state.propertyOperators,
            [correction.propertyId]: correction.operatorId,
          }
        : state.propertyOperators,
    operationEdits:
      correction.kind === "payment"
        ? {
            ...state.operationEdits,
            [correction.operationId]: {
              paymentDate: correction.paymentDate,
              paymentMethod: correction.paymentMethod,
            },
          }
        : state.operationEdits,
    progress: Object.fromEntries(
      Object.entries(state.progress).map(([key, progress]) => [
        key,
        { ...progress, ready: false },
      ]),
    ),
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
  const recordedMethods = new Map(
    snapshot.result.rows.map((row) => [row.id, row.paymentMethod]),
  );
  const signature = (value: ReportResult) =>
    JSON.stringify(
      value.rows.map((row) => [
        row.id,
        row.status,
        row.value,
        row.effectiveDate,
        recordedMethods.get(row.id) === "unknown" ? null : row.paymentMethod,
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
    "Mode de paiement",
    "Canal de réservation",
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
        paymentMethodLabel(row.paymentMethod),
        row.channel,
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
