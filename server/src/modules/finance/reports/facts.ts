import { createHash } from "node:crypto";
import {
  buildNightOperations,
  allocateOtaPriceRows,
  validOtaPriceSnapshot,
  computeTouristTax,
  allocateCents,
  getBookingSource,
  type ReportCategory,
  type ReportOperation,
  type ReportPaymentMethod,
  type ReportPaymentAlert,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { loadReservationPaymentTracking } from "../../reservationPayments/ledger.js";
import { fromJsonString } from "../../../utils/jsonFields.js";
import { buildReportScope } from "./scope.js";
import { reportOptionsSignature, storedAllocation } from "./allocation.js";
import type { OptionsInput } from "../../../services/contractCalculator.js";
import { endedStayPaymentAlert } from "./paymentAlerts.js";

const cents = (amount: number) => Math.round(amount * 100);
const day = (date: Date) => date.toISOString().slice(0, 10);
// Intl allocates native memory too; share one formatter across all receipts.
const paymentDayFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const paymentDay = (date: string | null) =>
  date ? paymentDayFormatter.format(new Date(date)) : null;
const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);
export { allocateCents } from "@contrats/shared";
const method = (value: string | null): ReportPaymentMethod =>
  value === "Virement"
    ? "transfer"
    : value === "Chèque"
      ? "cheque"
      : value === "Espèces"
        ? "cash"
        : value?.startsWith("Carte")
          ? "card"
          : value === "Versement plateforme"
            ? "platform"
            : value === "Autre"
              ? "other"
              : "unknown";

type Component = {
  propertyId: string;
  reservationId: string;
  category: ReportCategory;
  amount: number;
  uncertain?: boolean;
};
type SavedOptionDetail = {
  options_detail?: Record<string, number>;
  total_options?: number;
};

export async function loadReportFacts(
  db: TenantTransactionClient = prisma,
  now = new Date(),
) {
  const [
    gites,
    managerRows,
    reservations,
    quotes,
    socialHistory,
    nightHistory,
    cardModes,
  ] = await Promise.all([
    db.gite.findMany({
      orderBy: [{ ordre: "asc" }, { id: "asc" }],
      include: { fiscal_establishment: { include: { fiscal_entity: true } } },
    }),
    db.gestionnaire.findMany({ orderBy: [{ nom: "asc" }, { id: "asc" }] }),
    db.reservation.findMany({
      orderBy: [{ date_entree: "asc" }, { id: "asc" }],
    }),
    db.bookingRequest.findMany({
      where: { status: "approved", approved_reservation_id: { not: null } },
      select: {
        approved_reservation_id: true,
        options: true,
        pricing_snapshot: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.urssafDeclaration.findMany({
      include: { gestionnaire: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
    db.guestNightDeclaration.findMany({
      include: { gite: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
    db.bookingPayment.findMany({
      where: { paid_at: { not: null } },
      select: { id: true, stripe_mode: true },
    }),
  ]);
  const { managers, operators, properties } = buildReportScope(
    gites,
    managerRows,
  );
  if (reservations.some((row) => !row.gite_id))
    properties.push({
      id: "unassigned",
      name: "Sans logement",
      initials: "?",
      operatorId: null,
    });
  const testCardIds = new Set(
    cardModes
      .filter((payment) => payment.stripe_mode !== "live")
      .map((payment) => payment.id),
  );
  const tracking = await loadReservationPaymentTracking(
    reservations.map((row) => row.id),
    db,
    now,
  );
  const groups = new Map<string, typeof reservations>();
  for (const row of reservations)
    groups.set(row.stay_group_id ?? row.id, [
      ...(groups.get(row.stay_group_id ?? row.id) ?? []),
      row,
    ]);
  const operations: ReportOperation[] = [];
  const stayPaymentAlerts: ReportPaymentAlert[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const ledger = tracking.get(first.id)!;
    const paymentAlert = endedStayPaymentAlert(
      {
        reservationId: first.id,
        guest: first.hote_nom,
        bookingSource: getBookingSource(first),
        stays: rows.map((row) => ({
          propertyId: row.gite_id ?? "unassigned",
          propertyLabel:
            properties.find((property) => property.id === row.gite_id)?.name ??
            "Sans logement",
          arrival: day(row.date_entree),
          departure: day(row.date_sortie),
        })),
      },
      ledger,
      testCardIds,
      now,
    );
    if (paymentAlert) stayPaymentAlerts.push(paymentAlert);
    const options = fromJsonString<OptionsInput>(first.options, {});
    const nights = sum(rows.map((row) => row.nb_nuits));
    const base = rows.map((row) => Math.max(0, cents(Number(row.prix_total))));
    const discount = allocateCents(
      Math.min(sum(base), cents(Number(first.remise_montant))),
      base,
    );
    const net = base.map((value, i) => value - discount[i]);
    const validPrice = validOtaPriceSnapshot(
      options.ota_price,
      sum(net),
      options,
      getBookingSource(first),
    );
    const priceParts = validPrice
      ? allocateOtaPriceRows(options.ota_price!, net).gross
      : [net, net.map(() => 0), net.map(() => 0), net.map(() => 0)];
    const rental = priceParts[0];
    const tax = options.tourist_tax
      ? computeTouristTax({
          stay: options.tourist_tax,
          nights,
          adults: first.nb_adultes,
          children: first.nb_enfants_2_17,
          accommodation: sum(rental) / 100,
          start: day(first.date_entree),
        })
      : null;
    const accommodation = allocateCents(
      cents(tax?.accommodation_amount ?? sum(rental) / 100),
      rental,
    );
    const hostTax = allocateCents(
      cents(tax?.host_amount ?? 0),
      rows.map((row) => row.nb_nuits),
    );
    const fees = rows.map((row) =>
      Math.max(0, cents(Number(row.frais_optionnels_montant))),
    );
    const savedQuote = quotes.find(
      (quote) =>
        rows.some((row) => row.id === quote.approved_reservation_id) &&
        reportOptionsSignature(quote.options) ===
          reportOptionsSignature(first.options),
    );
    const saved = fromJsonString<SavedOptionDetail>(
      savedQuote?.pricing_snapshot,
      {},
    );
    const savedValues = saved.options_detail;
    const validDetails =
      savedValues &&
      cents(saved.total_options ?? -1) === sum(fees) &&
      ["draps", "linge", "menage", "depart_tardif", "chiens"].every(
        (key) => Number.isFinite(savedValues[key]) && savedValues[key] >= 0,
      ) &&
      cents(sum(Object.values(savedValues))) === sum(fees);
    const selected = (
      [
        ["draps", "linen"],
        ["linge_toilette", "linen"],
        ["menage", "cleaning"],
        ["depart_tardif", "extras"],
        ["chiens", "extras"],
      ] as const
    ).filter(
      ([key]) =>
        options[key]?.enabled && !options[key]?.offert && !options[key]?.inclus,
    );
    const components: Component[] = [];
    const detailRemaining = validDetails
      ? [
          cents(savedValues.menage),
          cents(savedValues.draps + savedValues.linge),
          cents(savedValues.depart_tardif + savedValues.chiens),
        ]
      : [];
    rows.forEach((row, i) => {
      const add = (
        category: ReportCategory,
        amount: number,
        uncertain = false,
      ) => {
        const existing = components.find(
          (item) => item.reservationId === row.id && item.category === category,
        );
        if (existing) {
          existing.amount += amount;
          existing.uncertain ||= uncertain;
          return;
        }
        if (amount)
          components.push({
            propertyId: row.gite_id ?? "unassigned",
            reservationId: row.id,
            category,
            amount,
            uncertain,
          });
      };
      add("accommodation", accommodation[i]);
      for (const [j, category] of (
        ["cleaning", "linen", "extras"] as const
      ).entries()) {
        add(category, priceParts[j + 1][i]);
      }
      add("tourist_tax", hostTax[i]);
      const quotedAllocation = validDetails
        ? allocateCents(fees[i], detailRemaining)
        : [];
      quotedAllocation.forEach((amount, j) => {
        detailRemaining[j] -= amount;
      });
      const manual = storedAllocation(row);
      if (manual) {
        add("cleaning", manual.cleaning);
        add("linen", manual.linen);
        add("extras", manual.extras);
      } else if (validDetails) {
        const allocated = quotedAllocation;
        (["cleaning", "linen", "extras"] as const).forEach((category, j) =>
          add(category, allocated[j]),
        );
      } else if (new Set(selected.map(([, category]) => category)).size === 1)
        add(selected[0][1], fees[i]);
      else add("extras", fees[i], true);
    });
    const total = sum(components.map((row) => row.amount));
    const baseOperation = (component: Component) => {
      const reservation = rows.find(
        (row) => row.id === component.reservationId,
      )!;
      return {
        reservation: reservation.id,
        reservationId: reservation.id,
        guest: reservation.hote_nom,
        propertyId: component.propertyId,
        propertyLabel:
          properties.find((row) => row.id === component.propertyId)?.name ??
          component.propertyId,
        category: component.category,
        stayDate: day(reservation.date_entree),
        channel: getBookingSource(reservation),
        bookingSource: getBookingSource(reservation),
        nights: 0,
        ...(component.uncertain ? { categoryUncertain: true } : {}),
      };
    };
    for (const component of components) {
      operations.push({
        ...baseOperation(component),
        id: `stay:${component.reservationId}:${component.category}`,
        amountCents: component.amount,
        paymentDate: null,
        paymentMethod: "unknown",
        basis: "stay",
      });
    }
    const declarationSourceSignature = createHash("sha256")
      .update(
        JSON.stringify({
          stays: rows,
          properties: gites
            .filter((gite) => rows.some((row) => row.gite_id === gite.id))
            .map((gite) => ({
              id: gite.id,
              name: gite.nom,
              address: [gite.adresse_ligne1, gite.adresse_ligne2],
            })),
          payments: ledger.entries,
        }),
      )
      .digest("hex");
    operations.push(
      ...buildNightOperations(
        rows.map((row) => ({
          ...row,
          infants:
            fromJsonString<OptionsInput>(row.options, {}).tourist_tax
              ?.infants ?? 0,
          tourist_tax: options.tourist_tax,
        })),
      ).map((operation) => ({
        ...operation,
        declarationSourceSignature,
        propertyLabel: properties.find(
          (property) => property.id === operation.propertyId,
        )?.name,
      })),
    );
    const remaining = components.map((row) => row.amount);
    const explicitTaxMode = ledger.entries.some(
      (entry) => !entry.voided_at && entry.tourist_tax,
    );
    for (const entry of ledger.entries.filter(
      (entry) =>
        !entry.voided_at &&
        !testCardIds.has(entry.id) &&
        (entry.amount > 0 || (entry.refunded_amount ?? 0) > 0),
    )) {
      const received = cents(entry.amount + (entry.refunded_amount ?? 0));
      if (entry.ota) {
        const reservation =
          rows.find((row) => row.id === entry.reservation_id) ?? first;
        const splits = entry.ota.allocations ?? [entry.ota];
        for (const [index, amounts] of splits.entries()) {
          const destination =
            rows.find(
              (row) =>
                row.id ===
                ("reservationId" in amounts ? amounts.reservationId : null),
            ) ?? reservation;
          operations.push({
            ...baseOperation({
              propertyId: destination.gite_id ?? "unassigned",
              reservationId: destination.id,
              category: amounts.category,
              amount: amounts.grossCents,
            }),
            id: `receipt:${entry.id}:${destination.id}:${amounts.category}:${index}`,
            amountCents: amounts.grossCents,
            paymentDate: paymentDay(entry.paid_on),
            ...(entry.paid_on_estimated ? { paymentDateEstimated: true } : {}),
            paymentMethod: "platform",
            basis: "payment",
            channel: entry.ota.channel,
            ota: { ...entry.ota, ...amounts, allocations: undefined },
            ...(ledger.requires_review
              ? {
                  reviewReason:
                    "Un paiement ou remboursement reste à vérifier sur ce séjour.",
                }
              : {}),
            allocationNote: entry.paid_on_estimated
              ? "Versement de plateforme inclus automatiquement. Date estimée au lendemain de l’arrivée ; un règlement saisi ou importé remplace cette estimation."
              : entry.ota.source === "import" &&
                  entry.ota.dateSource === "manual"
                ? "Montants exacts du relevé ; date du règlement déjà saisi conservée."
                : entry.ota.source === "import"
                  ? "Montants exacts du relevé. Date de versement fournie par la plateforme ; arrivée bancaire non attestée par le relevé."
                  : entry.ota.source === "rate"
                    ? "Commission calculée avec le taux daté enregistré au moment du règlement."
                    : "Brut et commission renseignés lors de la saisie du règlement.",
          });
        }
        if (entry.ota.allocations) {
          // Source splits are exact: do not consume locally payable linen or cleaning proportionally.
          for (const split of splits) {
            const targetId =
              "reservationId" in split
                ? (split.reservationId ?? reservation.id)
                : reservation.id;
            const weights = components.map((component, i) =>
              component.reservationId === targetId &&
              component.category === split.category
                ? remaining[i]
                : 0,
            );
            const allocation = allocateCents(
              Math.min(split.grossCents, sum(weights)),
              weights,
            );
            allocation.forEach((amount, i) => {
              remaining[i] -= amount;
            });
          }
        } else {
          const weights = components.map((component, i) =>
            component.reservationId === reservation.id &&
            (entry.ota!.category === "accommodation"
              ? component.category === "accommodation"
              : component.category !== "accommodation")
              ? remaining[i]
              : 0,
          );
          const allocation = allocateCents(
            Math.min(received, sum(weights)),
            weights,
          );
          allocation.forEach((amount, i) => {
            remaining[i] -= amount;
          });
        }
        continue;
      }
      // Local platform extras and platform transfers have different scopes in the ledger.
      const preferAccommodation =
        entry.origin === "platform" || entry.method === "Versement plateforme";
      const preferExtras =
        Boolean(ledger.platform) &&
        !preferAccommodation &&
        entry.purpose !== "deposit";
      const taxWanted = explicitTaxMode
        ? (entry.tourist_tax?.amountCents ??
          (entry.purpose === "tourist_tax" ? received : 0))
        : 0;
      const taxWeights = components.map((row, i) =>
        row.category === "tourist_tax" ? remaining[i] : 0,
      );
      const taxSplit = allocateCents(
        Math.min(taxWanted, sum(taxWeights)),
        taxWeights,
      );
      const available = remaining.map((value, i) =>
        explicitTaxMode && components[i].category === "tourist_tax"
          ? 0
          : value - taxSplit[i],
      );
      const distributable = Math.max(0, received - sum(taxSplit));
      const preferred = components.map((row, i) =>
        (
          preferAccommodation
            ? row.category === "accommodation"
            : preferExtras
              ? row.category !== "accommodation"
              : true
        )
          ? available[i]
          : 0,
      );
      const firstAmount = Math.min(distributable, sum(preferred));
      const split = allocateCents(firstAmount, preferred);
      const rest = allocateCents(
        Math.min(distributable - firstAmount, sum(available) - firstAmount),
        available.map((value, i) => value - split[i]),
      );
      const amounts = split.map((value, i) => value + rest[i] + taxSplit[i]);
      const problems: string[] = [];
      if (entry.tourist_tax_stale || taxWanted > sum(taxSplit))
        problems.push(
          "La part de taxe confirmée ne correspond plus aux données du séjour. Vérifiez-la dans ses règlements.",
        );
      if (tax?.issues.length) problems.push(...tax.issues);
      if (cents(ledger.total) !== total)
        problems.push(
          "Le total du suivi des règlements diffère du montant de la réservation. Vérifiez le contrat et les prestations.",
        );
      if (ledger.requires_review)
        problems.push(
          "Un paiement par carte ou un remboursement reste à vérifier. La date du remboursement n’est pas disponible dans le registre.",
        );
      for (const [index, component] of components.entries()) {
        if (!amounts[index]) continue;
        remaining[index] -= amounts[index];
        operations.push({
          ...baseOperation(component),
          id: `receipt:${entry.id}:${component.reservationId}:${component.category}`,
          amountCents: amounts[index],
          paymentDate: paymentDay(entry.paid_on),
          ...(entry.paid_on_estimated ? { paymentDateEstimated: true } : {}),
          paymentMethod: method(entry.method),
          basis: "payment",
          ...(problems.length ? { reviewReason: problems.join(" ") } : {}),
          allocationNote:
            (entry.paid_on_estimated
              ? "Versement de plateforme inclus automatiquement. Date estimée au lendemain de l’arrivée ; un règlement saisi ou importé remplace cette estimation. "
              : "") +
            (entry.method === "Versement plateforme"
              ? "Montant enregistré utilisé ; importez le relevé pour détailler le brut et la commission. "
              : "") +
            (explicitTaxMode
              ? "La part de taxe confirmée est isolée au montant exact ; le reste du règlement est ventilé entre les autres catégories."
              : "Règlement ventilé au prorata des montants restant dus par logement et catégorie. Les versements de plateforme sont affectés à l’hébergement en priorité ; les règlements sur place aux prestations et à la taxe."),
        });
      }
      if (entry.refunded_amount) {
        const refundComponents = components.length
          ? components
          : [
              {
                propertyId: first.gite_id ?? "unassigned",
                reservationId: first.id,
                category: "accommodation" as const,
                amount: received,
              },
            ];
        const refunds = allocateCents(
          cents(entry.refunded_amount),
          components.length ? amounts : [received],
        );
        for (const [index, component] of refundComponents.entries()) {
          if (!refunds[index]) continue;
          operations.push({
            ...baseOperation(component),
            id: `refund-pending:${entry.id}:${component.reservationId}:${component.category}`,
            amountCents: -refunds[index],
            paymentDate: null,
            paymentMethod: method(entry.method),
            basis: "payment",
            reviewReason:
              "Remboursement par carte : date et affectation à rapprocher du relevé Stripe. La ventilation provisoire suit celle du paiement ; aucune imputation automatique à une période.",
          });
        }
      }
      const surplus = received - sum(amounts);
      if (surplus)
        operations.push({
          ...baseOperation(
            components[0] ?? {
              propertyId: first.gite_id ?? "unassigned",
              reservationId: first.id,
              category: "accommodation",
              amount: surplus,
            },
          ),
          id: `surplus:${entry.id}`,
          amountCents: surplus,
          paymentDate: paymentDay(entry.paid_on),
          ...(entry.paid_on_estimated ? { paymentDateEstimated: true } : {}),
          paymentMethod: method(entry.method),
          basis: "payment",
          reviewReason:
            "Encaissement supérieur au montant ventilable de la réservation. Vérifiez le règlement.",
        });
    }
  }
  operations.sort((a, b) => a.id.localeCompare(b.id));
  const operatorIssues = Object.fromEntries(
    gites
      .filter((gite) => !gite.fiscal_establishment_id && gite.gestionnaire_id)
      .map((gite) => [
        gite.id,
        "le propriétaire historique est renseigné, mais l’établissement facturant reste à rattacher.",
      ]),
  );
  const socialIssues = Object.fromEntries(
    gites.flatMap((gite) => {
      const entity = gite.fiscal_establishment?.fiscal_entity;
      if (
        !entity ||
        ["franchise_en_base", "exonere", "hors_champ"].includes(
          entity.vat_regime,
        )
      )
        return [];
      return [
        [
          gite.id,
          {
            entityId: entity.id,
            message:
              entity.vat_regime === "unknown"
                ? `${entity.legal_name} : régime de TVA à préciser avant de finaliser le rapport social.`
                : `${entity.legal_name} : la TVA doit être séparée des encaissements. Le registre actuel ne contient pas cette ventilation ; rapprochez ces montants des factures.`,
          },
        ],
      ];
    }),
  );
  const propertyOperators = Object.fromEntries(
    properties.map((row) => [row.id, row.operatorId]),
  );
  const propertyManagers = Object.fromEntries(
    properties.map((row) => [row.id, row.managerId ?? null]),
  );
  const propertyNightDeclarations = Object.fromEntries(
    properties.map((row) => [row.id, row.declaration]),
  );
  const factsRevision = createHash("sha256")
    .update(
      JSON.stringify({
        properties,
        operators,
        managers,
        operations,
        stayPaymentAlerts,
        operatorIssues,
        socialIssues,
      }),
    )
    .digest("hex");
  const legacyDeclarations = [
    ...socialHistory.map((row) => ({
      id: row.id,
      kind: "social" as const,
      period: `${row.year}-${String(row.month).padStart(2, "0")}`,
      subject: `${row.gestionnaire.prenom} ${row.gestionnaire.nom}`,
      value: cents(Number(row.amount)),
      confirmedAt: row.declared_at.toISOString(),
      propertyIds: gites
        .filter((gite) => gite.gestionnaire_id === row.gestionnaire_id)
        .map((gite) => gite.id),
    })),
    ...nightHistory.map((row) => ({
      id: row.id,
      kind: "tourist" as const,
      period: `${row.year}-${String(row.month).padStart(2, "0")}`,
      subject: row.gite.nom,
      value: row.guest_nights,
      confirmedAt: row.declared_at.toISOString(),
      propertyIds: [row.gite_id],
    })),
  ];
  return {
    properties,
    operators,
    managers,
    operations,
    stayPaymentAlerts,
    propertyOperators,
    propertyManagers,
    propertyNightDeclarations,
    operatorIssues,
    socialIssues,
    factsRevision,
    legacyDeclarations,
  };
}
