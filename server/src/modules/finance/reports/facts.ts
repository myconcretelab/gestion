import { createHash } from "node:crypto";
import {
  computeTouristTax,
  getBookingSource,
  type ReportCategory,
  type ReportOperation,
  type ReportOperator,
  type ReportPaymentMethod,
  type ReportProperty,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { loadReservationPaymentTracking } from "../../reservationPayments/ledger.js";
import { fromJsonString } from "../../../utils/jsonFields.js";
import { reportOptionsSignature, storedAllocation } from "./allocation.js";
import type { OptionsInput } from "../../../services/contractCalculator.js";

const cents = (amount: number) => Math.round(amount * 100);
const day = (date: Date) => date.toISOString().slice(0, 10);
const paymentDay = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(date))
    : null;
const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);
/** Largest remainders: allocations always conserve every cent, including tiny receipts. */
export function allocateCents(total: number, weights: number[]) {
  const weight = sum(weights);
  if (!weight) return weights.map(() => 0);
  const shares = weights.map((n) => Math.floor((total * n) / weight));
  const order = weights
    .map((n, i) => ({ i, rest: (total * n) % weight }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let left = total - sum(shares), i = 0; left > 0; left--, i++)
    shares[order[i % order.length].i]++;
  return shares;
}
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

export async function loadReportFacts(db: TenantTransactionClient = prisma) {
  const [
    gites,
    managers,
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
  const operators: ReportOperator[] = managers.map((row) => ({
    id: `manager:${row.id}`,
    name: `${row.prenom} ${row.nom}`.trim(),
    legacy: true,
  }));
  for (const gite of gites) {
    const entity = gite.fiscal_establishment?.fiscal_entity;
    if (entity && !operators.some((row) => row.id === entity.id))
      operators.push({ id: entity.id, name: entity.legal_name, legacy: false });
  }
  const properties: ReportProperty[] = gites.map((row) => ({
    id: row.id,
    name: row.nom,
    initials: row.nom
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join(""),
    operatorId:
      row.fiscal_establishment?.fiscal_entity_id ??
      (row.gestionnaire_id ? `manager:${row.gestionnaire_id}` : null),
  }));
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
  );
  const groups = new Map<string, typeof reservations>();
  for (const row of reservations)
    groups.set(row.stay_group_id ?? row.id, [
      ...(groups.get(row.stay_group_id ?? row.id) ?? []),
      row,
    ]);
  const operations: ReportOperation[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const ledger = tracking.get(first.id)!;
    const options = fromJsonString<OptionsInput>(first.options, {});
    const nights = sum(rows.map((row) => row.nb_nuits));
    const base = rows.map((row) => Math.max(0, cents(Number(row.prix_total))));
    const discount = allocateCents(
      Math.min(sum(base), cents(Number(first.remise_montant))),
      base,
    );
    const net = base.map((value, i) => value - discount[i]);
    const tax = options.tourist_tax
      ? computeTouristTax({
          stay: options.tourist_tax,
          nights,
          adults: first.nb_adultes,
          children: first.nb_enfants_2_17,
          accommodation: sum(net) / 100,
          start: day(first.date_entree),
        })
      : null;
    const accommodation = allocateCents(
      cents(tax?.accommodation_amount ?? sum(net) / 100),
      net,
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
        options[key]?.enabled &&
        !options[key]?.offert &&
        !(key === "menage" && options.menage?.inclus),
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
    const source = getBookingSource(first);
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
        channel: source,
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
    // One row per occupied night: stays crossing months are split at the calendar boundary.
    for (const row of rows) {
      const end = +row.date_sortie;
      for (let date = +row.date_entree; date < end;) {
        const dateString = day(new Date(date));
        const monthEnd = Date.UTC(
          new Date(date).getUTCFullYear(),
          new Date(date).getUTCMonth() + 1,
          1,
        );
        const segmentEnd = Math.min(end, monthEnd);
        const occupiedNights = Math.round((segmentEnd - date) / 86400000);
        operations.push({
          id: `night:${row.id}:${dateString.slice(0, 7)}`,
          reservation: row.id,
          reservationId: row.id,
          guest: row.hote_nom,
          propertyId: row.gite_id ?? "unassigned",
          propertyLabel: properties.find(
            (p) => p.id === (row.gite_id ?? "unassigned"),
          )?.name,
          category: "accommodation",
          amountCents: 0,
          nights:
            occupiedNights *
            (row.nb_adultes +
              row.nb_enfants_2_17 +
              (options.tourist_tax?.infants ?? 0)),
          stayDate: dateString,
          paymentDate: null,
          channel: source,
          paymentMethod: "unknown",
          basis: "nights",
        });
        date = segmentEnd;
      }
    }
    const remaining = components.map((row) => row.amount);
    for (const entry of ledger.entries.filter(
      (entry) =>
        !entry.voided_at &&
        !testCardIds.has(entry.id) &&
        (entry.amount > 0 || (entry.refunded_amount ?? 0) > 0),
    )) {
      const received = cents(entry.amount + (entry.refunded_amount ?? 0));
      // Local platform extras and platform transfers have different scopes in the ledger.
      const preferAccommodation =
        entry.origin === "platform" || entry.method === "Versement plateforme";
      const preferExtras =
        Boolean(ledger.platform) &&
        !preferAccommodation &&
        entry.purpose !== "deposit";
      const preferred = components.map((row, i) =>
        (
          preferAccommodation
            ? row.category === "accommodation"
            : preferExtras
              ? row.category !== "accommodation"
              : true
        )
          ? remaining[i]
          : 0,
      );
      const firstAmount = Math.min(received, sum(preferred));
      const split = allocateCents(firstAmount, preferred);
      const rest = allocateCents(
        Math.min(received - firstAmount, sum(remaining) - firstAmount),
        remaining.map((value, i) => value - split[i]),
      );
      const amounts = split.map((value, i) => value + rest[i]);
      const problems: string[] = [];
      if (tax?.issues.length) problems.push(...tax.issues);
      if (cents(ledger.total) !== total)
        problems.push(
          "Le total du suivi des règlements diffère du montant de la réservation. Vérifiez le contrat et les prestations.",
        );
      if (ledger.requires_review)
        problems.push(
          "Un paiement par carte ou un remboursement reste à vérifier. La date du remboursement n’est pas disponible dans le registre.",
        );
      if (entry.origin === "platform")
        problems.push(
          "Versement de plateforme estimé : renseignez le règlement reçu et sa date.",
        );
      for (const [index, component] of components.entries()) {
        if (!amounts[index]) continue;
        remaining[index] -= amounts[index];
        operations.push({
          ...baseOperation(component),
          id: `receipt:${entry.id}:${component.reservationId}:${component.category}`,
          amountCents: amounts[index],
          paymentDate: paymentDay(entry.paid_on),
          paymentMethod: method(entry.method),
          basis: "payment",
          ...(problems.length ? { reviewReason: problems.join(" ") } : {}),
          allocationNote:
            "Règlement ventilé au prorata des montants restant dus par logement et catégorie. Les versements de plateforme sont affectés à l’hébergement en priorité ; les règlements sur place aux prestations et à la taxe.",
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
  const factsRevision = createHash("sha256")
    .update(
      JSON.stringify({
        properties,
        operators,
        operations,
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
    })),
    ...nightHistory.map((row) => ({
      id: row.id,
      kind: "tourist" as const,
      period: `${row.year}-${String(row.month).padStart(2, "0")}`,
      subject: row.gite.nom,
      value: row.guest_nights,
      confirmedAt: row.declared_at.toISOString(),
    })),
  ];
  return {
    properties,
    operators,
    operations,
    propertyOperators,
    operatorIssues,
    socialIssues,
    factsRevision,
    legacyDeclarations,
  };
}
