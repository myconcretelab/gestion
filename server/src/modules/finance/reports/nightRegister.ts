import { createHash } from "node:crypto";
import {
  computeTouristTax,
  evaluateReport,
  getReportPeriod,
  reportDefinitionSchema,
  reportPeriodKey,
  touristTaxStaySchema,
  parseTouristTaxSettings,
  touristTaxDeclarationDetails,
  resolveTouristTaxRegistration,
  summarizeNightRegister,
  buildNightTaxBasis,
  allocateNightTaxCollections,
  isNightCollectionKey,
  validOtaPriceSnapshot,
  otaIncludedTotal,
  getBookingSource,
  type ReportDefinition,
  type NightRegister,
  type NightRegisterRow,
  type ReportState,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { fromJsonString } from "../../../utils/jsonFields.js";
import { loadReservationPaymentTracking } from "../../reservationPayments/ledger.js";
import { nightTaxSegments } from "../../reservationPayments/taxBasis.js";
import { loadReportFacts } from "./facts.js";
import type { OptionsInput } from "../../../services/contractCalculator.js";

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const day = (date: Date) => date.toISOString().slice(0, 10);
const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
const parisDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Current sources and immutable confirmed registers share the same export path. */
export async function getNightRegister(
  reportId: string,
  month: string,
  archive?: { resolution?: number; key?: string },
): Promise<NightRegister> {
  return prisma.$transaction(
    async (db) => {
      const store = await db.financeReportStore.findFirst();
      const config = fromJsonString<ReportState | null>(store?.data_json, null);
      const raw = config?.reports.find((report) => report.id === reportId);
      if (!raw) throw fail("Rapport introuvable.", 404);
      const report = reportDefinitionSchema.parse(raw);
      if (archive) {
        const progress =
          config!.progress[archive.key ?? reportPeriodKey(report, month)];
        const copy =
          archive.resolution === undefined
            ? progress?.snapshot
            : progress?.resolutions?.[archive.resolution];
        if (!copy?.nightRegister || copy.definition.id !== reportId)
          throw fail(
            "Cette ancienne copie ne contient pas de registre archivé.",
            404,
          );
        return copy.nightRegister;
      }
      if (raw.kind !== "tourist")
        throw fail("Le registre des séjours concerne les rapports de nuitées.");
      return buildNightRegister(db, report, month, config!);
    },
    { timeout: 60_000 },
  );
}

export async function buildNightRegister(
  db: TenantTransactionClient,
  report: ReportDefinition,
  month: string,
  config: Pick<ReportState, "overrides" | "nightRegisterCompletions">,
  facts?: Awaited<ReturnType<typeof loadReportFacts>>,
): Promise<NightRegister> {
  facts ??= await loadReportFacts(db, new Date(), Number(month.slice(0, 4)));
  if (
    report.propertyIds.some(
      (id) => !facts.properties.some((property) => property.id === id),
    )
  )
    throw fail(
      "Un gîte du rapport n’existe plus. Vérifiez son périmètre avant de télécharger le registre.",
    );
  const period = getReportPeriod(month, report.cadence);
  if (
    report.managerId &&
    (!facts.managers.some((manager) => manager.id === report.managerId) ||
      report.propertyIds.some(
        (id) => facts.propertyManagers[id] !== report.managerId,
      ))
  )
    throw fail(
      "Le rattachement au gestionnaire a changé. Vérifiez le périmètre du rapport avant de télécharger le registre.",
    );
  const gites = await db.gite.findMany({
    where: { id: { in: report.propertyIds } },
    orderBy: [{ ordre: "asc" }, { id: "asc" }],
  });
  const properties = gites.map((gite) => {
    const declaration = touristTaxDeclarationDetails(
      parseTouristTaxSettings(gite.taxe_sejour_config),
    );
    const registration = resolveTouristTaxRegistration(
      report.nightRegistrations?.[gite.id],
      declaration,
    );
    return {
      id: gite.id,
      name: gite.nom,
      portalReference: declaration?.portalReference || null,
      ...(declaration?.receiptReference
        ? { declarationReceiptReference: declaration.receiptReference }
        : {}),
      address: [gite.adresse_ligne1, gite.adresse_ligne2]
        .filter(Boolean)
        .join(", "),
      registrationNumber: registration?.notApplicable
        ? "Non applicable"
        : registration?.number || null,
    };
  });
  const propertiesById = new Map(
    properties.map((property) => [property.id, property]),
  );
  const evaluated = evaluateReport(
    report,
    month,
    config.overrides[reportPeriodKey(report, month)],
    facts.operations,
    { ...facts, operationEdits: {} },
  );
  const ids = [
    ...new Set(
      evaluated.rows
        .filter((row) => row.status !== "excluded")
        .flatMap((row) => (row.reservationId ? [row.reservationId] : [])),
    ),
  ];
  const reservations = await db.reservation.findMany({
    where: { id: { in: ids } },
    include: { gite: true },
    orderBy: [{ date_entree: "asc" }, { id: "asc" }],
  });
  const groupIds = [
    ...new Set(
      reservations.flatMap((row) =>
        row.stay_group_id ? [row.stay_group_id] : [],
      ),
    ),
  ];
  const siblings = groupIds.length
    ? await db.reservation.findMany({
        where: { stay_group_id: { in: groupIds } },
        orderBy: [{ date_entree: "asc" }, { id: "asc" }],
      })
    : [];
  const tracking = await loadReservationPaymentTracking(ids, db);
  const testPayments = new Set(
    (
      await db.bookingPayment.findMany({
        where: { stripe_mode: { not: "live" } },
        select: { id: true },
      })
    ).map((payment) => payment.id),
  );
  const rows: NightRegisterRow[] = [];
  const plans = new Map<
    string,
    {
      basis: ReturnType<typeof buildNightTaxBasis>;
      allocation: ReturnType<typeof allocateNightTaxCollections>;
    }
  >();
  for (const [index, reservation] of reservations.entries()) {
    const group = reservation.stay_group_id
      ? siblings.filter(
          (row) => row.stay_group_id === reservation.stay_group_id,
        )
      : [reservation];
    const first = group[0] ?? reservation;
    const options = fromJsonString<OptionsInput>(first.options, {});
    const checked = touristTaxStaySchema.safeParse(options.tourist_tax);
    const stayTax = checked.success ? checked.data : null;
    const nightsInGroup = group.reduce((sum, row) => sum + row.nb_nuits, 0);
    const accommodation =
      group.reduce((sum, row) => sum + Number(row.prix_total), 0) -
      Number(first.remise_montant);
    const includedOptions = validOtaPriceSnapshot(
      options.ota_price,
      cents(accommodation),
      options,
      getBookingSource(first),
    )
      ? otaIncludedTotal(options.ota_price!.included) / 100
      : 0;
    const tax = stayTax
      ? computeTouristTax({
          stay: stayTax,
          nights: nightsInGroup,
          adults: first.nb_adultes,
          children: first.nb_enfants_2_17,
          accommodation: accommodation - includedOptions,
          start: day(first.date_entree),
        })
      : null;
    const arrival = day(reservation.date_entree),
      departure = day(reservation.date_sortie);
    const start = arrival > period.start ? arrival : period.start;
    const end = departure < period.end ? departure : period.end;
    const nights = Math.max(
      0,
      Math.round((Date.parse(end) - Date.parse(start)) / 86400000),
    );
    const infantsRecorded =
      typeof options.tourist_tax === "object" &&
      options.tourist_tax !== null &&
      Object.hasOwn(options.tourist_tax, "infants");
    const infants = stayTax && infantsRecorded ? stayTax.infants : null;
    const occupants =
      infants === null
        ? null
        : reservation.nb_adultes + reservation.nb_enfants_2_17 + infants;
    const issues: string[] = [];
    const address = [
      reservation.gite?.adresse_ligne1,
      reservation.gite?.adresse_ligne2,
    ]
      .filter(Boolean)
      .join(", ");
    if (!address) issues.push("Adresse du gîte à compléter.");
    const registrationNumber =
      propertiesById.get(reservation.gite_id!)?.registrationNumber ?? null;
    if (!registrationNumber)
      issues.push("Numéro d’enregistrement à compléter s’il s’applique.");
    if (!stayTax)
      issues.push(
        "Barème du séjour, collecteur, bébés et exonérations non enregistrés.",
      );
    else if (infants === null)
      issues.push(
        "Nombre de bébés non enregistré ; nombre total de personnes à compléter.",
      );
    if (tax?.issues.length) issues.push(...tax.issues);
    if (group.length > 1)
      issues.push(
        "Séjour regroupé : ventilation entre hébergements et périodes à vérifier.",
      );
    const crossesPeriod = arrival < period.start || departure > period.end;
    if (crossesPeriod)
      issues.push(
        "Séjour à cheval sur plusieurs périodes : affectation de la taxe collectée à compléter sans la compter deux fois.",
      );
    const classified = stayTax?.settings.classified ?? null;
    const flatPrice =
      cents(Number(reservation.prix_par_nuit)) * reservation.nb_nuits ===
        cents(Number(reservation.prix_total)) &&
      Number(reservation.remise_montant) === 0;
    const netCents = tax ? cents(tax.accommodation_amount) : null;
    const nightlyPriceCents =
      flatPrice &&
      group.length === 1 &&
      netCents !== null &&
      reservation.nb_nuits > 0 &&
      netCents % reservation.nb_nuits === 0
        ? netCents / reservation.nb_nuits
        : null;
    if (classified === null)
      issues.push("Classement du gîte au moment du séjour à vérifier.");
    if (classified !== true && nightlyPriceCents === null)
      issues.push(
        "Prix de chaque nuitée hors taxe de séjour à compléter ; aucun prix moyen n’est substitué à un tarif non vérifiable.",
      );
    const reasons = [
      reservation.nb_enfants_2_17 || infants ? "Personnes mineures" : "",
      stayTax?.exemption_reason,
    ]
      .filter(Boolean)
      .join(" ; ");
    const exemptionReason = stayTax
      ? reasons || "Aucune exonération renseignée"
      : null;
    if (stayTax?.collector === "platform")
      issues.push(
        "Taxe collectée par la plateforme : renseigner ses perceptions, sans la présenter comme collectée par l’hébergeur.",
      );
    const entries = (tracking.get(reservation.id)?.entries ?? []).filter(
      (entry) =>
        !entry.voided_at &&
        !testPayments.has(entry.id) &&
        entry.amount > 0 &&
        (entry.purpose === "tourist_tax" ||
          entry.ota?.category === "tourist_tax" ||
          entry.tourist_tax),
    );
    const collections = stayTax?.collector === "host" ? entries : [];
    let plan = plans.get(first.id);
    if (!plan) {
      const basis = buildNightTaxBasis(nightTaxSegments(group), tax);
      const allocation = allocateNightTaxCollections(
        basis,
        collections.map((entry) => ({
          id: entry.id,
          amountCents:
            entry.tourist_tax?.amountCents ??
            entry.ota?.grossCents ??
            cents(entry.amount + (entry.refunded_amount ?? 0)),
          paidOn: entry.paid_on,
          needsReview: Boolean(
            entry.tourist_tax_stale ||
            entry.refunded_amount ||
            tracking.get(reservation.id)?.requires_review,
          ),
        })),
      );
      plan = { basis, allocation };
      plans.set(first.id, plan);
    }
    const { basis, allocation } = plan;
    const noTaxDue = Boolean(tax && !tax.issues.length && tax.amount === 0);
    if (
      !collections.length &&
      stayTax?.collector !== "not_applicable" &&
      !noTaxDue
    )
      issues.push(
        "Date et montant réels de perception de la taxe non identifiés. Un règlement global n’est pas assimilé à une perception de taxe.",
      );
    for (const [collectionIndex, entry] of (collections.length
      ? collections
      : [null]
    ).entries()) {
      const lineIssues = [...issues];
      const collectionDate =
        entry?.paid_on && !entry.paid_on_estimated
          ? parisDate.format(new Date(entry.paid_on))
          : null;
      if (entry && !collectionDate)
        lineIssues.push("Date de perception non enregistrée ou estimée.");
      if ((entry?.refunded_amount ?? 0) > 0)
        lineIssues.push(
          "Remboursement présent : perception nette et date du remboursement à vérifier.",
        );
      if (entry?.tourist_tax_stale)
        lineIssues.push(
          "La part de taxe du règlement est à vérifier après une modification du séjour ou du barème.",
        );
      const collectedTaxCents =
        entry &&
        group.length === 1 &&
        !crossesPeriod &&
        !(entry.refunded_amount ?? 0)
          ? (entry.tourist_tax?.amountCents ??
            entry.ota?.grossCents ??
            cents(entry.amount))
          : stayTax?.collector === "not_applicable" || noTaxDue
            ? 0
            : null;
      const additionalTaxes = noTaxDue
        ? "Aucune taxe due selon le barème enregistré"
        : stayTax?.collector === "not_applicable"
          ? "Sans perception : non-application déclarée"
          : stayTax?.settings.additional_percentage === 0
            ? "Aucune selon le barème enregistré"
            : null;
      if (!additionalTaxes)
        lineIssues.push(
          "Ventilation et montants collectés par taxe additionnelle à compléter s’ils s’appliquent.",
        );
      const operationIssues = evaluated.rows
        .filter(
          (row) =>
            row.reservationId === reservation.id && row.status === "review",
        )
        .flatMap((row) => row.issues.map((issue) => issue.message));
      lineIssues.push(...operationIssues);
      const proposed = allocation.allocations
        .get(entry?.id ?? "")
        ?.filter(
          (slice) =>
            slice.reservationId === reservation.id &&
            slice.start >= period.start &&
            slice.end <= period.end,
        );
      const proposedBase =
        proposed?.reduce((total, slice) => total + slice.baseCents, 0) ?? 0;
      const proposedAdditional =
        proposed?.reduce((total, slice) => total + slice.additionalCents, 0) ??
        0;
      const variablePrices =
        classified === false && crossesPeriod && nightlyPriceCents === null;
      const otherCompletions = Object.entries(
        config.nightRegisterCompletions ?? {},
      ).filter(
        ([key]) =>
          key !== reportPeriodKey(report, month) &&
          key.startsWith(`${report.id}:`) &&
          key.endsWith(`:${report.cadence}`),
      );
      const legacyAllocation =
        entry &&
        otherCompletions.some(([, completion]) =>
          group.some(
            (row) =>
              (completion.rows[`stay:${row.id}`]?.collectedTaxCents ?? 0) > 0,
          ),
        );
      const elsewhere = entry
        ? otherCompletions.reduce(
            (total, [, completion]) =>
              total +
              Object.entries(completion.rows)
                .filter(([key]) => isNightCollectionKey(key, entry.id))
                .reduce(
                  (sum, [, edit]) => sum + (edit.collectedTaxCents ?? 0),
                  0,
                ),
            0,
          )
        : 0;
      const currentProposedTotal =
        allocation.allocations
          .get(entry?.id ?? "")
          ?.filter(
            (slice) =>
              ids.includes(slice.reservationId) &&
              slice.start >= period.start &&
              slice.end <= period.end,
          )
          .reduce(
            (total, slice) => total + slice.baseCents + slice.additionalCents,
            0,
          ) ?? 0;
      const allocationConflict =
        legacyAllocation ||
        (entry &&
          elsewhere + currentProposedTotal >
            (entry.tourist_tax?.amountCents ??
              entry.ota?.grossCents ??
              cents(entry.amount)));
      const euro = (value: number) =>
        (value / 100).toFixed(2).replace(".", ",");
      rows.push({
        key: entry
          ? group.length > 1
            ? `${entry.id}:stay:${reservation.id}`
            : entry.id
          : `stay:${reservation.id}`,
        ...(entry
          ? {
              collectionId: entry.id,
              collectionReservationIds: group.map((row) => row.id),
            }
          : {}),
        ...(entry &&
        collectionDate &&
        proposed?.length &&
        !allocationConflict &&
        !variablePrices &&
        (group.length > 1 || crossesPeriod || basis.additionalPercentage > 0)
          ? {
              allocationProposal: {
                collectionDate,
                collectedTaxCents: proposedBase + proposedAdditional,
                collectedBaseTaxCents: proposedBase,
                additionalTaxes: basis.additionalPercentage
                  ? `Taxes additionnelles au taux global enregistré (${basis.additionalPercentage} %) : ${euro(proposedAdditional)} €`
                  : "Aucune selon le barème enregistré",
                explanation:
                  "Proposition calculée sur les nuits taxables de l’ensemble du séjour et la taxe confirmée de chaque règlement. Les centimes restants sont répartis sans dépasser la perception ; les taxes additionnelles utilisent le taux global du barème enregistré. Vérifiez les montants et précisez le nom des taxes sur justificatifs.",
              },
            }
          : entry && (allocation.reason || allocationConflict || variablePrices)
            ? {
                allocationUnavailableReason:
                  allocation.reason ??
                  (variablePrices
                    ? "Le prix exact de chaque nuit du séjour non classé est à vérifier ; aucune répartition fondée sur un prix moyen n’est proposée."
                    : null) ??
                  "Une ventilation différente est déjà enregistrée sur une autre période. Vérifiez-la avant de répartir à nouveau cette perception.",
              }
            : {}),
        reference: `Séjour ${index + 1}${collections.length > 1 ? ` / perception ${collectionIndex + 1}` : ""}`,
        reservationId: reservation.id,
        propertyId: reservation.gite_id!,
        propertyName: reservation.gite?.nom ?? "Gîte à vérifier",
        address,
        registrationNumber,
        arrival,
        departure,
        periodStart: start,
        periodEnd: end,
        collectionDate,
        collector: stayTax?.collector ?? "unknown",
        adults: reservation.nb_adultes,
        taxableAdults:
          tax && !tax.issues.length
            ? stayTax!.collector === "not_applicable"
              ? 0
              : Math.max(0, reservation.nb_adultes - stayTax!.exempt_adults)
            : null,
        exemptAdults: tax && !tax.issues.length ? stayTax!.exempt_adults : null,
        children: reservation.nb_enfants_2_17,
        infants,
        occupants,
        nights,
        personNights: occupants === null ? null : occupants * nights,
        classified,
        nightlyPriceCents,
        collectedTaxCents,
        observedCollectionCents: entry
          ? (entry.tourist_tax?.amountCents ??
            entry.ota?.grossCents ??
            cents(entry.amount + (entry.refunded_amount ?? 0)))
          : null,
        collectedBaseTaxCents:
          stayTax?.collector === "not_applicable" ||
          noTaxDue ||
          stayTax?.settings.additional_percentage === 0
            ? collectedTaxCents
            : null,
        calculatedStayTaxCents: tax ? cents(tax.amount) : null,
        additionalTaxes,
        exemptionReason,
        source:
          evaluated.rows.find((row) => row.reservationId === reservation.id)
            ?.bookingSource ??
          evaluated.rows.find((row) => row.reservationId === reservation.id)
            ?.channel ??
          "",
        issues: [...new Set(lineIssues)],
      });
    }
  }
  rows.sort(
    (a, b) =>
      (a.collectionDate ?? "9999").localeCompare(b.collectionDate ?? "9999") ||
      a.arrival.localeCompare(b.arrival) ||
      a.reference.localeCompare(b.reference, "fr", { numeric: true }),
  );
  const { favorite: _favorite, ...definition } = report;
  const sourceRevision = createHash("sha256")
    .update(
      JSON.stringify({
        report: definition,
        rows,
        properties,
        sourceSignatures: evaluated.rows
          .filter((row) => row.status !== "excluded")
          .map(
            (row) =>
              facts.operations.find((operation) => operation.id === row.id)
                ?.declarationSourceSignature,
          ),
      }),
    )
    .digest("hex");
  const completion =
    config.nightRegisterCompletions?.[reportPeriodKey(report, month)];
  const completionCurrent = completion?.sourceRevision === sourceRevision;
  if (completion && !completionCurrent)
    rows.forEach((row) =>
      row.issues.push(
        "Les sources ont changé : vérifiez et enregistrez à nouveau les compléments du registre.",
      ),
    );
  if (completionCurrent)
    for (const row of rows) {
      const edit = completion.rows[row.key];
      if (!edit) continue;
      if (row.collector !== "unknown" && row.collector !== "not_applicable") {
        row.collectionDate = edit.collectionDate;
        row.collectedTaxCents = edit.collectedTaxCents;
        row.collectedBaseTaxCents = edit.collectedBaseTaxCents;
        row.additionalTaxes = edit.additionalTaxes || null;
        const perceptionComplete =
          row.collectionDate !== null && row.collectedTaxCents !== null;
        const splitComplete =
          row.collectedTaxCents !== null &&
          row.collectedBaseTaxCents !== null &&
          row.collectedBaseTaxCents <= row.collectedTaxCents &&
          Boolean(row.additionalTaxes);
        row.issues = row.issues.filter(
          (issue) =>
            !(
              (perceptionComplete &&
                (issue.startsWith("Date et montant réels") ||
                  issue.startsWith("Date de perception") ||
                  issue.startsWith("Taxe collectée par la plateforme"))) ||
              (splitComplete &&
                issue.startsWith("Ventilation et montants collectés")) ||
              (perceptionComplete &&
                splitComplete &&
                edit.allocationReviewed &&
                (issue.startsWith("Séjour regroupé") ||
                  issue.startsWith("Séjour à cheval") ||
                  issue.startsWith("Remboursement présent")))
            ),
        );
        if (
          row.collectedTaxCents !== null &&
          row.collectedBaseTaxCents !== null &&
          row.collectedBaseTaxCents > row.collectedTaxCents
        )
          row.issues.push(
            "La part hors taxes additionnelles dépasse le total collecté.",
          );
        if (edit.allocationReviewed && !perceptionComplete)
          row.issues.push(
            "La ventilation vérifiée doit indiquer la date et le montant collectés.",
          );
        if (
          (!row.collectionDate || row.collectedTaxCents === null) &&
          !(row.calculatedStayTaxCents === 0 && row.collectedTaxCents === 0)
        )
          row.issues.push(
            "Date et montant réels de perception de la taxe à compléter.",
          );
        if (!splitComplete)
          row.issues.push(
            "Ventilation et montants collectés par taxe additionnelle à compléter.",
          );
      }
      if (edit.nightlyPriceCents !== null && row.classified === false) {
        row.nightlyPriceCents = edit.nightlyPriceCents;
        row.issues = row.issues.filter(
          (issue) => !issue.startsWith("Prix de chaque nuitée"),
        );
      }
      if (edit.nightlyPrices?.length && row.classified === false) {
        const prices = [...edit.nightlyPrices].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        if (
          prices.length === row.nights &&
          new Set(prices.map((night) => night.date)).size === row.nights &&
          prices.every(
            (night) =>
              night.date >= row.periodStart && night.date < row.periodEnd,
          )
        ) {
          row.nightlyPrices = prices;
          row.nightlyPriceCents = null;
          row.issues = row.issues.filter(
            (issue) => !issue.startsWith("Prix de chaque nuitée"),
          );
        } else
          row.issues.push(
            "Le détail des prix doit couvrir chaque nuit de la période une seule fois.",
          );
      }
    }
  const register: NightRegister = {
    reportId: report.id,
    reportName: report.name,
    recipient: report.recipient,
    period: { label: period.label, start: period.start, end: period.end },
    generatedAt: new Date().toISOString(),
    sourceRevision,
    revision: createHash("sha256")
      .update(JSON.stringify({ sourceRevision, rows, completion }))
      .digest("hex"),
    ...(completion ? { completion } : {}),
    reportNights: evaluated.total,
    stayCount: reservations.length,
    incompleteCount: new Set(
      rows.filter((row) => row.issues.length).map((row) => row.reservationId),
    ).size,
    properties,
    rows,
    summary: summarizeNightRegister({ properties, rows }),
  };
  return register;
}
