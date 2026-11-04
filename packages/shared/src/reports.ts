import { reportNightValue, type NightGuestGroup } from "./nightOperations.js";
import {
  resolveTouristTaxRegistration,
  type TouristTaxDeclarationDetails,
} from "./touristTax.js";

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
  { id: "platform", label: "Versement plateforme" },
  { id: "other", label: "Autre" },
  { id: "unknown", label: "Non renseigné" },
] as const;
export type ReportPaymentMethod = (typeof REPORT_PAYMENT_METHODS)[number]["id"];
export type ReportKind = "social" | "tourist" | "owner" | "custom";
export type ReportCadence = "monthly" | "quarterly" | "yearly" | "broceliande";
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
  operatorId?: string | null;
  managerId?: string | null;
  /** Override the organization's tracking start for this report only. */
  worklistStartMonth?: string;
  /** Undefined keeps all sources, including sources added later. */
  bookingSources?: string[];
  otaAmountBasis?: "gross" | "net";
  nightGuests?: NightGuestGroup[];
  nightReference?: boolean;
  nightDeclaration?: boolean;
  nightRegistrations?: Record<
    string,
    { number: string; notApplicable: boolean }
  >;
  excludedBookingSources?: string[];
};
export type ReportOperation = {
  id: string;
  reservation: string;
  guest: string;
  propertyId: string;
  category: ReportCategory;
  amountCents: number;
  nights: number;
  nightCounts?: Record<NightGuestGroup, number>;
  taxableNights?: number | null;
  nightTaxIssue?: string;
  paymentDate: string | null;
  paymentDateEstimated?: boolean;
  stayDate: string;
  channel: string;
  /** Reservation source, independently of the platform used for a payment. */
  bookingSource?: string;
  paymentMethod: ReportPaymentMethod;
  reviewReason?: string;
  propertyLabel?: string;
  reservationId?: string;
  basis?: "payment" | "stay" | "nights";
  declarationSourceSignature?: string;
  allocationNote?: string;
  categoryUncertain?: boolean;
  ota?: import("./ota.js").OtaAmounts;
};
export type OperationStatus = "included" | "review" | "excluded";
export type OperationOverride = {
  status: OperationStatus;
  note: string;
  sourceSignature?: string;
};
export type ReportIssue = {
  kind: "operator" | "payment" | "settings" | "fiscal" | "correction";
  sourceId?: string;
  message: string;
  actionLabel: string;
};
export type ReportSources = {
  propertyNightDeclarations?: Record<
    string,
    TouristTaxDeclarationDetails | undefined
  >;
  nightRegisterCompletionRevisions?: Record<string, string>;
  nightRegisterCompletions?: Record<
    string,
    import("./nightRegister.js").NightRegisterCompletion
  >;
  propertyOperators: Record<string, string | null>;
  propertyManagers?: Record<string, string | null>;
  operatorIssues?: Record<string, string>;
  socialIssues?: Record<string, { message: string; entityId: string }>;
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
  confirmedBy?: string | null;
  definition: ReportDefinition;
  result: ReportResult;
  nightRegister?: import("./nightRegister.js").NightRegister;
};
export type ReportResolution = {
  resolvedAt: string;
  resolvedBy?: string | null;
  outcome: "corrected" | "kept";
  note: string;
  definition: ReportDefinition;
  result: ReportResult;
  nightRegister?: import("./nightRegister.js").NightRegister;
};
export type ReportProgress = {
  ready?: boolean;
  snapshot?: ReportSnapshot;
  readyFingerprint?: string;
  readyFactsRevision?: string;
  resolutions?: ReportResolution[];
};
export type ReportState = ReportSources &
  import("./touristTaxRemittance.js").TaxRemittanceState & {
    version: 3;
    reports: ReportDefinition[];
    drafts: Record<string, ReportDefinition>;
    overrides: Record<string, Record<string, OperationOverride>>;
    progress: Record<string, ReportProgress>;
    /** Earlier periods were already treated before the worklist was adopted. */
    worklistStartMonth?: string;
    nightSettingsVersion?: number;
    nightSettingsWarnings?: string[];
  };

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
    name: "Nuitées",
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
    recipient: "À renseigner",
    dateBasis: kind === "tourist" ? "stay" : "payment",
    cadence: "monthly",
    categories:
      kind === "tourist"
        ? ["accommodation"]
        : kind === "custom"
          ? ["cleaning", "linen", "extras"]
          : [...revenueCategories],
    propertyIds: [],
    operatorId: null,
    ...(kind === "tourist"
      ? { bookingSources: ["Direct"], nightGuests: ["adults" as const] }
      : {}),
    favorite: kind === "social",
  };
}

export const categoryLabel = (id: ReportCategory) =>
  REPORT_CATEGORIES.find((category) => category.id === id)!.label;
export const propertyName = (id: string) => id;
export const paymentMethodLabel = (id: ReportPaymentMethod) =>
  REPORT_PAYMENT_METHODS.find((method) => method.id === id)!.label;
export const reportBookingSourcesLabel = (
  report: Pick<ReportDefinition, "bookingSources" | "excludedBookingSources">,
) =>
  report.bookingSources === undefined
    ? report.excludedBookingSources?.length
      ? `Toutes sauf ${report.excludedBookingSources.join(", ")}`
      : "Toutes les sources"
    : report.bookingSources.length
      ? report.bookingSources.join(", ")
      : "Aucune source sélectionnée";
export const reportIncludesBookingSource = (
  report: Pick<ReportDefinition, "bookingSources" | "excludedBookingSources">,
  operation: Pick<ReportOperation, "bookingSource" | "channel">,
) =>
  !report.excludedBookingSources?.includes(
    operation.bookingSource ?? operation.channel,
  ) &&
  (report.bookingSources === undefined ||
    report.bookingSources.includes(
      operation.bookingSource ?? operation.channel,
    ));
export const cadenceLabel = (cadence: ReportCadence) =>
  ({
    monthly: "Mensuel",
    quarterly: "Trimestriel",
    yearly: "Annuel",
    broceliande: "Périodes de Brocéliande Communauté",
  })[cadence];

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const amountFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export function getReportPeriod(month: string, cadence: ReportCadence) {
  const [year, monthNumber] = month.split("-").map(Number);
  const startMonth =
    cadence === "broceliande"
      ? monthNumber <= 5
        ? 1
        : monthNumber <= 9
          ? 6
          : 10
      : cadence === "yearly"
        ? 1
        : cadence === "quarterly"
          ? Math.floor((monthNumber - 1) / 3) * 3 + 1
          : monthNumber;
  const length =
    cadence === "broceliande"
      ? startMonth === 1
        ? 5
        : startMonth === 6
          ? 4
          : 3
      : cadence === "yearly"
        ? 12
        : cadence === "quarterly"
          ? 3
          : 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, startMonth - 1 + length, 1));
  const end = endDate.toISOString().slice(0, 10);
  const label =
    cadence === "broceliande"
      ? `${monthFormatter.format(new Date(Date.UTC(year, startMonth - 1, 1)))} – ${monthFormatter.format(new Date(Date.UTC(year, startMonth + length - 2, 1)))}`
      : cadence === "yearly"
        ? String(year)
        : cadence === "quarterly"
          ? `${Math.floor((monthNumber - 1) / 3) + 1}ᵉ trimestre ${year}`
          : monthFormatter.format(new Date(`${start}T12:00:00Z`));
  return { start, end, label, key: `${start}:${cadence}` };
}

export const reportPeriodKey = (report: ReportDefinition, month: string) =>
  `${report.id}:${getReportPeriod(month, report.cadence).key}`;

export const operationSourceSignature = (operation: ReportOperation) =>
  JSON.stringify([
    operation.reservationId,
    operation.propertyId,
    operation.category,
    operation.amountCents,
    operation.nights,
    ...(operation.nightCounts ? [operation.nightCounts] : []),
    operation.paymentDate,
    operation.stayDate,
    operation.paymentMethod,
    operation.basis,
    operation.categoryUncertain,
    operation.reviewReason,
    operation.ota,
    ...(operation.declarationSourceSignature
      ? [operation.declarationSourceSignature]
      : []),
    ...(operation.paymentDateEstimated ? ["estimated-payment-date"] : []),
  ]);

export function evaluateReport(
  report: ReportDefinition,
  month: string,
  overrides: Record<string, OperationOverride> = {},
  operations: ReportOperation[] = [],
  sources: ReportSources = {
    propertyOperators: {},
    operationEdits: {},
  },
): ReportResult {
  const period = getReportPeriod(month, report.cadence);
  const rows: EvaluatedOperation[] = [];
  for (const original of operations) {
    if (
      original.basis &&
      original.basis !==
        (report.kind === "tourist" ? "nights" : report.dateBasis)
    )
      continue;
    const effectiveDate =
      report.dateBasis === "payment"
        ? (sources.operationEdits[original.id]?.paymentDate ??
          original.paymentDate)
        : original.stayDate;
    // A missing payment date is surfaced in its stay period; it never enters the total automatically.
    const candidateDate = effectiveDate ?? original.stayDate;
    if (candidateDate < period.start || candidateDate >= period.end) continue;
    const operation = { ...original, ...sources.operationEdits[original.id] };
    if (report.kind === "tourist" && report.nightDeclaration) {
      if (operation.taxableNights == null)
        operation.reviewReason =
          operation.nightTaxIssue ??
          "Nuitées taxables à vérifier dans la réservation.";
      const declaration =
        sources.propertyNightDeclarations?.[operation.propertyId];
      operation.declarationSourceSignature = JSON.stringify([
        operation.declarationSourceSignature,
        sources.nightRegisterCompletionRevisions?.[
          reportPeriodKey(report, month)
        ],
        resolveTouristTaxRegistration(
          report.nightRegistrations?.[operation.propertyId],
          declaration,
        ),
        ...(declaration?.receiptReference
          ? [declaration.receiptReference]
          : []),
      ]);
    } else delete operation.declarationSourceSignature;
    const inProperty = report.propertyIds.includes(operation.propertyId);
    const inSource = reportIncludesBookingSource(report, operation);
    const uncertainCategories =
      operation.categoryUncertain && report.kind !== "tourist";
    const optionalCategories: ReportCategory[] = [
      "cleaning",
      "linen",
      "extras",
    ];
    const inCategory =
      report.categories.includes(operation.category) ||
      Boolean(
        uncertainCategories &&
        optionalCategories.some((category) =>
          report.categories.includes(category),
        ),
      );
    const operatorMismatch =
      report.kind === "social" &&
      Boolean(report.operatorId) &&
      Boolean(sources.propertyOperators[operation.propertyId]) &&
      sources.propertyOperators[operation.propertyId] !== report.operatorId;
    const override = overrides[operation.id];
    const issues: ReportIssue[] = [];
    const staleCorrection = Boolean(
      override?.sourceSignature &&
      override.sourceSignature !== operationSourceSignature(operation),
    );
    if (staleCorrection)
      issues.push({
        kind: "correction",
        message:
          "Les données de cette correction ont changé. Réexaminez l’opération avant de finaliser le rapport.",
        actionLabel: "Réexaminer la correction",
      });
    if (
      (inProperty && inCategory && inSource) ||
      (inSource && override?.status === "included")
    ) {
      if (
        report.managerId &&
        sources.propertyManagers?.[operation.propertyId] !== report.managerId
      )
        issues.push({
          kind: "settings",
          message:
            "Le rattachement du logement au gestionnaire a changé : vérifiez le périmètre du rapport.",
          actionLabel: "Modifier le périmètre",
        });
      if (report.kind === "social" && !report.operatorId)
        issues.push({
          kind: "settings",
          message:
            "Sélectionnez l’exploitant concerné dans les réglages du rapport.",
          actionLabel: "Choisir l’exploitant",
        });
      if (
        report.kind === "social" &&
        sources.socialIssues?.[operation.propertyId]
      )
        issues.push({
          kind: "fiscal",
          sourceId: sources.socialIssues[operation.propertyId].entityId,
          message: sources.socialIssues[operation.propertyId].message,
          actionLabel: "Vérifier la TVA",
        });
      if (operatorMismatch)
        issues.push({
          kind: "settings",
          message:
            "Le rattachement du logement a changé : vérifiez l’exploitant sélectionné dans ce rapport.",
          actionLabel: "Modifier le périmètre",
        });
      if (operation.reviewReason)
        issues.push({
          kind: "payment",
          message: operation.reviewReason,
          actionLabel: "Vérifier la réservation",
        });
      if (
        uncertainCategories &&
        !optionalCategories.every((category) =>
          report.categories.includes(category),
        )
      )
        issues.push({
          kind: "payment",
          message:
            "La ventilation des prestations n’est pas renseignée. Le total des prestations est conservé.",
          actionLabel: "Vérifier les prestations",
        });
      if (
        report.kind === "social" &&
        (!sources.propertyOperators[operation.propertyId] ||
          sources.operatorIssues?.[operation.propertyId])
      )
        issues.push({
          kind: "operator",
          message: `${operation.propertyLabel ?? propertyName(operation.propertyId)} : ${sources.operatorIssues?.[operation.propertyId] ?? "aucun exploitant rattaché."}`,
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
        report.dateBasis === "payment" &&
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
      !inProperty || !inCategory || !inSource
        ? "excluded"
        : issues.length
          ? "review"
          : "included";
    let reason = !inProperty
      ? "Ce logement ne fait pas partie du périmètre."
      : !inCategory
        ? "Cette catégorie ne fait pas partie du périmètre."
        : !inSource
          ? `La source ${operation.bookingSource ?? operation.channel} ne fait pas partie du périmètre.`
          : issues.length
            ? issues.map((issue) => issue.message).join(" ")
            : `Logement et catégorie inclus dans le rapport${operation.category === "accommodation" && report.kind !== "tourist" ? ` · ${paymentMethodLabel(operation.paymentMethod)}` : ""}.`;
    if (
      inSource &&
      override &&
      report.kind !== "social" &&
      report.kind !== "tourist"
    ) {
      status =
        staleCorrection || (override.status === "included" && issues.length)
          ? "review"
          : override.status;
      reason =
        status === "review" && issues.length
          ? issues.map((issue) => issue.message).join(" ")
          : `Correction pour ce rapport : ${override.note}`;
    }
    const value =
      report.kind === "tourist"
        ? report.nightDeclaration
          ? (operation.taxableNights ?? 0)
          : reportNightValue(operation, report.nightGuests)
        : operation.ota
          ? report.otaAmountBasis === "net"
            ? operation.ota.netCents
            : operation.ota.grossCents
          : operation.amountCents;
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

export const reportAmountBasisLabel = (
  report: Pick<ReportDefinition, "otaAmountBasis">,
) =>
  report.otaAmountBasis === "net"
    ? "Net après commissions"
    : "Brut avant commissions";

export function operationAmountBasisLabel(
  report: Pick<ReportDefinition, "kind" | "dateBasis" | "otaAmountBasis">,
  operation: Pick<ReportOperation, "ota" | "paymentMethod">,
) {
  if (report.kind === "tourist") return "Nuitées";
  if (report.dateBasis === "stay") return "Montant du séjour";
  if (operation.ota) return reportAmountBasisLabel(report);
  return operation.paymentMethod === "platform"
    ? "Montant enregistré · commission non détaillée"
    : "Montant encaissé";
}

export function platformAmountBreakdown(result: ReportResult) {
  const included = result.rows.filter((row) => row.status === "included");
  const detailed = included.filter((row) => row.ota);
  const undetailed = included.filter(
    (row) => row.paymentMethod === "platform" && !row.ota,
  );
  return {
    detailedCount: detailed.length,
    grossCents: detailed.reduce((sum, row) => sum + row.ota!.grossCents, 0),
    feeCents: detailed.reduce((sum, row) => sum + row.ota!.feeCents, 0),
    netCents: detailed.reduce((sum, row) => sum + row.ota!.netCents, 0),
    undetailedCount: undetailed.length,
    undetailedCents: undetailed.reduce((sum, row) => sum + row.value, 0),
    otherCents: included
      .filter((row) => !row.ota && row.paymentMethod !== "platform")
      .reduce((sum, row) => sum + row.value, 0),
  };
}

export function reportTotalLabel(
  report: ReportDefinition,
  result: ReportResult,
) {
  if (report.kind === "tourist")
    return report.nightDeclaration
      ? "Total des nuitées taxables incluses"
      : "Total des nuitées incluses";
  if (report.dateBasis === "stay") return "Total des recettes au séjour";
  const amounts = platformAmountBreakdown(result);
  if (amounts.undetailedCount)
    return "Total avec des commissions non renseignées";
  if (!amounts.detailedCount) return "Total des recettes incluses";
  return report.otaAmountBasis === "net"
    ? "Total net après commissions des plateformes"
    : "Total brut avant commissions des plateformes";
}

export const formatReportValue = (
  report: Pick<ReportDefinition, "kind">,
  value: number,
) =>
  report.kind === "tourist"
    ? `${value.toLocaleString("fr-FR")} nuitée${Math.abs(value) === 1 ? "" : "s"}`
    : amountFormatter.format(value / 100);

/** Compare the last examined data, while retaining the original confirmation. */
export function reportReference(progress: ReportProgress | undefined) {
  if (!progress?.snapshot) return undefined;
  return progress.resolutions?.at(-1) ?? progress.snapshot;
}

export function reportChanges(
  snapshot: Pick<ReportSnapshot, "result">,
  result: ReportResult,
) {
  const before = new Map(snapshot.result.rows.map((row) => [row.id, row]));
  const after = new Map(result.rows.map((row) => [row.id, row]));
  const signature = (row: EvaluatedOperation, recorded?: EvaluatedOperation) =>
    JSON.stringify([
      row.id,
      row.status,
      row.value,
      row.effectiveDate,
      recorded?.paymentMethod === "unknown" ? null : row.paymentMethod,
      ...(row.paymentDateEstimated ? ["estimated-payment-date"] : []),
      ...(row.declarationSourceSignature
        ? [row.declarationSourceSignature]
        : []),
    ]);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const oldRow = before.get(id);
    const newRow = after.get(id);
    return !oldRow ||
      !newRow ||
      signature(oldRow, oldRow) !== signature(newRow, oldRow)
      ? [{ id, before: oldRow, after: newRow }]
      : [];
  });
}

export function snapshotDiffers<T extends Pick<ReportSnapshot, "result">>(
  snapshot: T,
  result: ReportResult,
) {
  return reportChanges(snapshot, result).length > 0;
}

export function reportHasPendingChanges(
  progress: ReportProgress | undefined,
  result: ReportResult,
) {
  const reference = reportReference(progress);
  return Boolean(reference && snapshotDiffers(reference, result));
}

export function reportStatus(
  progress: ReportProgress | undefined,
  result: ReportResult,
) {
  if (progress?.snapshot)
    return reportHasPendingChanges(progress, result)
      ? "Écart à examiner"
      : progress.resolutions?.length
        ? "Écart résolu"
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
    "Réservation",
    "Voyageur",
    "Logement",
    "Catégorie",
    "Mode de paiement",
    "Canal de réservation",
    "Date retenue",
    report.kind === "tourist"
      ? report.nightDeclaration
        ? "Nuitées taxables"
        : "Nuitées"
      : "Montant EUR",
    "Traitement",
    "Explication",
    "Brut OTA EUR",
    "Commission OTA EUR",
    "Net OTA EUR",
    "Base OTA du rapport",
    "Date estimée",
    "Base du montant retenu",
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
        row.propertyLabel ?? propertyName(row.propertyId),
        categoryLabel(row.category),
        paymentMethodLabel(row.paymentMethod),
        row.bookingSource ?? row.channel,
        row.effectiveDate ?? "À vérifier",
        report.kind === "tourist" ? row.value : row.value / 100,
        labels[row.status],
        row.reason,
        row.ota ? row.ota.grossCents / 100 : "",
        row.ota ? row.ota.feeCents / 100 : "",
        row.ota ? row.ota.netCents / 100 : "",
        report.otaAmountBasis === "net" ? "Net plateforme" : "Brut",
        report.dateBasis === "payment" && row.paymentDateEstimated
          ? "Oui (arrivée + 1 jour)"
          : "",
        operationAmountBasisLabel(report, row),
      ]),
    ]
      .map((row) => row.map(quote).join(";"))
      .join("\r\n")
  );
}
