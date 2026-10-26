import {
  computeTouristTax,
  getContractReceiptStatus,
  getBookingSource,
  legacyPaymentMethod,
  AUTOMATIC_PAYMENT_PLATFORMS,
  type ReservationPaymentEntry,
  type ReservationPaymentTracking,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { fromJsonString } from "../../utils/jsonFields.js";
import { cents } from "../bookingPayments/money.js";
import type { OptionsInput } from "../../services/contractCalculator.js";
import { readReservationPaymentSettings } from "../../services/reservationPaymentSettings.js";

export const ledgerError = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
type Db = TenantTransactionClient;
const ledgerTransaction = async <T>(work: (db: Db) => Promise<T>) => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (["P2034", "P1008", "P2028", "P2002"].includes(code || "")) {
      throw ledgerError(
        "Les règlements ont été modifiés en parallèle. Actualisez la fiche avant de réessayer.",
      );
    }
    throw error;
  }
};
type Stay = Awaited<ReturnType<typeof loadStays>>[number];
const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

async function loadStays(ids: string[], db: Db) {
  const selected = await db.reservation.findMany({
    where: { id: { in: ids } },
    include: { gite: { select: { arrhes_taux_defaut: true } } },
  });
  const groups = [
    ...new Set(
      selected
        .map((row) => row.stay_group_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const siblings = groups.length
    ? await db.reservation.findMany({
        where: { stay_group_id: { in: groups } },
        include: { gite: { select: { arrhes_taux_defaut: true } } },
      })
    : [];
  return [
    ...new Map([...selected, ...siblings].map((row) => [row.id, row])).values(),
  ];
}
const stayKey = (row: { id: string; stay_group_id: string | null }) =>
  row.stay_group_id || row.id;

export const loadReservationPaymentTracking = async (
  ids: string[],
  db: Db = prisma,
) => {
  const stays = ids.length ? await loadStays(ids, db) : [];
  if (!stays.length) return new Map<string, ReservationPaymentTracking>();
  const allIds = stays.map((row) => row.id);
  const [contracts, receipts, payments, settings] = await Promise.all([
    db.contrat.findMany({
      where: { reservation_id: { in: allIds } },
      orderBy: [{ date_creation: "desc" }, { id: "desc" }],
    }),
    db.bookingPayment.findMany({
      where: {
        paid_at: { not: null },
        OR: [
          { reservation_id: { in: allIds } },
          {
            booking_request: {
              is: {
                approved_reservation_id: { in: allIds },
                status: "approved",
              },
            },
          },
        ],
      },
      include: { booking_request: true, payment_link: true },
      orderBy: [{ paid_at: "asc" }, { id: "asc" }],
    }),
    db.reservationRecordedPayment.findMany({
      where: { reservation_id: { in: allIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    readReservationPaymentSettings(db),
  ]);
  const groups = new Map<string, Stay[]>();
  stays.forEach((row) =>
    groups.set(stayKey(row), [...(groups.get(stayKey(row)) || []), row]),
  );
  const result = new Map<string, ReservationPaymentTracking>();
  for (const rows of groups.values()) {
    rows.sort(
      (a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id),
    );
    const first = rows[0];
    const rowIds = new Set(rows.map((row) => row.id));
    const contract = contracts.find(
      (row) => row.reservation_id && rowIds.has(row.reservation_id),
    );
    const stripe = receipts.filter((row) =>
      rowIds.has(
        row.reservation_id ||
          row.booking_request?.approved_reservation_id ||
          "",
      ),
    );
    const manual = payments.filter((row) => rowIds.has(row.reservation_id));
    const managed = rows.some((row) => row.payments_managed);
    const accommodation = Math.max(
      0,
      sum(rows.map((row) => Number(row.prix_total))) -
        Number(first.remise_montant || 0),
    );
    const options = fromJsonString<OptionsInput>(first.options, {});
    const tax = options.tourist_tax
      ? computeTouristTax({
          stay: options.tourist_tax,
          nights: sum(rows.map((row) => row.nb_nuits)),
          adults: first.nb_adultes,
          children: first.nb_enfants_2_17,
          accommodation,
          start: first.date_entree.toISOString().slice(0, 10),
        })
      : null;
    const quote = fromJsonString<{ arrhes_theoriques?: number }>(
      stripe.find((row) => row.booking_request)?.booking_request
        ?.pricing_snapshot,
      {},
    );
    const rawTotal =
      (tax?.accommodation_amount ?? accommodation) +
      sum(rows.map((row) => Number(row.frais_optionnels_montant))) +
      (tax?.host_amount || 0);
    const source = getBookingSource(first);
    const isPlatform = (
      AUTOMATIC_PAYMENT_PLATFORMS as readonly string[]
    ).includes(source);
    // Platform stays can acquire local extras after an older contract or card payment.
    const total = isPlatform
      ? cents(rawTotal)
      : contract
        ? cents(
            Number(contract.arrhes_montant) + Number(contract.solde_montant),
          )
        : stripe.length
          ? stripe[stripe.length - 1].total_cents
          : cents(rawTotal);
    const deposit = contract
      ? cents(Number(contract.arrhes_montant))
      : quote.arrhes_theoriques !== undefined
        ? cents(quote.arrhes_theoriques)
        : (stripe[stripe.length - 1]?.payment_link?.deposit_cents ??
          cents(accommodation * Number(first.gite?.arrhes_taux_defaut || 0)));
    const stripeNet = sum(
      stripe.map((row) =>
        Math.max(0, row.paid_amount_cents - row.refunded_amount_cents),
      ),
    );
    const entries: ReservationPaymentEntry[] = stripe.map((row) => ({
      id: row.id,
      amount:
        Math.max(0, row.paid_amount_cents - row.refunded_amount_cents) / 100,
      method: "Carte · Stripe",
      purpose: row.purpose,
      paid_on: iso(row.paid_at),
      note: row.status === "requires_review" ? "Paiement à vérifier" : null,
      origin: "stripe",
      voided_at: null,
      refunded_amount: row.refunded_amount_cents / 100,
    }));
    if (managed) {
      entries.push(
        ...manual.map((row): ReservationPaymentEntry => ({
          id: row.id,
          amount: row.amount_cents / 100,
          method: row.method,
          purpose: row.purpose,
          paid_on: iso(row.paid_on),
          note: row.note,
          origin: row.origin === "legacy" ? "legacy" : "manual",
          voided_at: iso(row.voided_at),
        })),
      );
    } else {
      const legacyMethod =
        legacyPaymentMethod(contract?.mode_paiement_arrhes) ||
        legacyPaymentMethod(first.source_paiement);
      const offlineDeposit =
        contract?.statut_paiement_arrhes === "recu" &&
        contract.mode_paiement_arrhes !== "Stripe"
          ? deposit
          : 0;
      const offlineBalance =
        contract?.statut_paiement_solde === "regle"
          ? Math.max(
              0,
              cents(Number(contract.solde_montant)) -
                Math.max(0, stripeNet - Math.max(0, deposit - offlineDeposit)),
            )
          : 0;
      const offlineTotal = Math.max(
        offlineDeposit + offlineBalance,
        0,
        ...stripe.map((row) =>
          Math.max(
            0,
            (row.payment_link?.offline_received_cents || 0) -
              (fromJsonString<{ platform_automatic_received?: number }>(
                row.payment_link?.terms_json,
                {},
              ).platform_automatic_received ?? 0),
          ),
        ),
      );
      if (offlineDeposit > 0)
        entries.push({
          id: `legacy-deposit-${contract!.id}`,
          amount: offlineDeposit / 100,
          method: legacyMethod,
          purpose: "deposit",
          paid_on: iso(contract!.date_paiement_arrhes),
          note: "Repris du contrat",
          origin: "legacy",
          voided_at: null,
        });
      if (offlineTotal > offlineDeposit)
        entries.push({
          id: `legacy-balance-${first.id}`,
          amount: (offlineTotal - offlineDeposit) / 100,
          method: legacyPaymentMethod(first.source_paiement),
          purpose: "balance",
          paid_on: null,
          note: "Règlement historique — date non renseignée",
          origin: "legacy",
          voided_at: null,
        });
    }
    const platformAccommodation = Math.min(
      total,
      cents(tax?.accommodation_amount ?? accommodation),
    );
    const actualPlatformReceived = sum(
      entries
        .filter(
          (entry) =>
            !entry.voided_at &&
            (entry.origin === "legacy" ||
              entry.method === "Versement plateforme" ||
              entry.purpose === "deposit"),
        )
        .map((entry) => cents(entry.amount)),
    );
    const localReceived = sum(
      entries
        .filter(
          (entry) =>
            !entry.voided_at &&
            entry.origin !== "legacy" &&
            entry.method !== "Versement plateforme" &&
            entry.purpose !== "deposit",
        )
        .map((entry) => cents(entry.amount)),
    );
    const localTotal = Math.max(0, total - platformAccommodation);
    const platformExpected = Math.max(
      0,
      platformAccommodation -
        actualPlatformReceived -
        Math.max(0, localReceived - localTotal),
    );
    const automatic = settings.platform_payments_received_automatically;
    if (isPlatform && automatic && platformExpected > 0) {
      entries.push({
        id: `platform-auto-${first.id}`,
        amount: platformExpected / 100,
        method: "Versement plateforme",
        purpose: "full",
        paid_on: null,
        note: `Hébergement considéré reçu automatiquement de ${source}. Les options et la taxe à encaisser sur place restent dues.`,
        origin: "platform",
        voided_at: null,
      });
    }
    entries.sort(
      (a, b) =>
        (a.paid_on || "").localeCompare(b.paid_on || "") ||
        a.id.localeCompare(b.id),
    );
    const received = sum(
      entries
        .filter((row) => !row.voided_at)
        .map((row) => Math.round(row.amount * 100)),
    );
    const tracking: ReservationPaymentTracking = {
      managed,
      total: total / 100,
      deposit: deposit / 100,
      received: received / 100,
      remaining: Math.max(0, total - received) / 100,
      overpaid: Math.max(0, received - total) / 100,
      requires_review: stripe.some(
        (row) =>
          row.status === "requires_review" || row.refunded_amount_cents > 0,
      ),
      entries,
      ...(isPlatform
        ? {
            platform: {
              source,
              automatic,
              accommodation: platformAccommodation / 100,
              expected: automatic ? 0 : platformExpected / 100,
              extras_remaining:
                Math.max(
                  0,
                  localTotal -
                    localReceived -
                    Math.max(0, actualPlatformReceived - platformAccommodation),
                ) / 100,
            },
          }
        : {}),
    };
    rows.forEach((row) => result.set(row.id, tracking));
  }
  return result;
};

export const getReservationPaymentTracking = async (
  id: string,
  db: Db = prisma,
) => {
  const tracking = (await loadReservationPaymentTracking([id], db)).get(id);
  if (!tracking) throw ledgerError("Réservation introuvable.", 404);
  return tracking;
};

const lockedStay = async (id: string, db: Db) => {
  const rows = await loadStays([id], db);
  if (!rows.length) throw ledgerError("Réservation introuvable.", 404);
  rows.sort(
    (a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id),
  );
  await db.reservation.update({
    where: { id: rows[0].id },
    data: { updatedAt: new Date() },
  });
  for (const row of rows.slice(1))
    await db.reservation.update({
      where: { id: row.id },
      data: { updatedAt: new Date() },
    });
  const ids = rows.map((row) => row.id);
  const pending = await db.bookingPayment.findFirst({
    where: {
      status: { in: ["creating", "pending"] },
      OR: [
        { reservation_id: { in: ids } },
        { booking_request: { is: { approved_reservation_id: { in: ids } } } },
      ],
    },
  });
  if (pending)
    throw ledgerError(
      "Un paiement par carte est en cours. Terminez ou annulez ce paiement avant de modifier les règlements.",
    );
  return { rows, ids, canonicalId: rows[0].id };
};

const materializeHistory = async (
  stay: Awaited<ReturnType<typeof lockedStay>>,
  tracking: ReservationPaymentTracking,
  db: Db,
) => {
  if (tracking.managed) return;
  for (const entry of tracking.entries.filter(
    (entry) => entry.origin === "legacy",
  )) {
    await db.reservationRecordedPayment.create({
      data: {
        id: entry.id,
        reservation_id: stay.canonicalId,
        amount_cents: Math.round(entry.amount * 100),
        method: entry.method,
        paid_on: entry.paid_on ? new Date(entry.paid_on) : null,
        purpose: entry.purpose,
        note: entry.note,
        origin: "legacy",
      },
    });
  }
  await db.reservation.updateMany({
    where: { id: { in: stay.ids } },
    data: { payments_managed: true },
  });
};

export const syncManagedContractPayments = async (
  reservationId: string,
  db: Db = prisma,
) => {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    select: { payments_managed: true },
  });
  if (!reservation?.payments_managed) return;
  const tracking = await getReservationPaymentTracking(reservationId, db);
  if (!tracking.managed) return;
  const rows = await loadStays([reservationId], db);
  const contracts = await db.contrat.findMany({
    where: { reservation_id: { in: rows.map((row) => row.id) } },
  });
  for (const contract of contracts) {
    const status = getContractReceiptStatus(
      tracking,
      Number(contract.arrhes_montant),
      Number(contract.arrhes_montant) + Number(contract.solde_montant),
    );
    await db.contrat.update({
      where: { id: contract.id },
      data: {
        ...status,
        date_paiement_arrhes: status.date_paiement_arrhes
          ? new Date(status.date_paiement_arrhes)
          : null,
      },
    });
  }
};

export type NewRecordedPayment = {
  id: string;
  amount: number;
  method: string;
  purpose: string;
  paid_on: string;
  note?: string | null;
};
export const addReservationPayment = async (
  id: string,
  input: NewRecordedPayment,
) =>
  ledgerTransaction(async (tx) => {
    const stay = await lockedStay(id, tx);
    const existing = await tx.reservationRecordedPayment.findUnique({
      where: { id: input.id },
    });
    if (existing) {
      if (
        !stay.ids.includes(existing.reservation_id) ||
        existing.amount_cents !== cents(input.amount) ||
        existing.method !== input.method ||
        existing.purpose !== input.purpose ||
        iso(existing.paid_on)?.slice(0, 10) !== input.paid_on ||
        (existing.note || null) !== (input.note || null)
      ) {
        throw ledgerError(
          "Cette saisie a déjà été utilisée pour un autre règlement.",
        );
      }
      return getReservationPaymentTracking(id, tx);
    }
    const tracking = await getReservationPaymentTracking(id, tx);
    if (tracking.requires_review)
      throw ledgerError(
        "Vérifiez le paiement en ligne ou son remboursement avant d’ajouter un règlement.",
      );
    if (cents(input.amount) > cents(tracking.remaining))
      throw ledgerError(
        "Le règlement dépasse le reste à payer. Actualisez la fiche et vérifiez le montant.",
      );
    await materializeHistory(stay, tracking, tx);
    await tx.reservationRecordedPayment.create({
      data: {
        id: input.id,
        reservation_id: stay.canonicalId,
        amount_cents: cents(input.amount),
        method: input.method,
        purpose: input.purpose,
        paid_on: new Date(`${input.paid_on}T12:00:00Z`),
        note: input.note || null,
      },
    });
    await syncManagedContractPayments(id, tx);
    return getReservationPaymentTracking(id, tx);
  });

export const voidReservationPayment = async (id: string, paymentId: string) =>
  ledgerTransaction(async (tx) => {
    const stay = await lockedStay(id, tx);
    let tracking = await getReservationPaymentTracking(id, tx);
    if (!tracking.managed) {
      const virtual = tracking.entries.find(
        (entry) => entry.id === paymentId && entry.origin === "legacy",
      );
      if (!virtual) throw ledgerError("Règlement introuvable.", 404);
      await materializeHistory(stay, tracking, tx);
      tracking = await getReservationPaymentTracking(id, tx);
      const materialized = tracking.entries.find(
        (entry) => entry.id === virtual.id,
      );
      if (!materialized)
        throw ledgerError("Règlement historique introuvable.", 404);
      paymentId = materialized.id;
    }
    const row = await tx.reservationRecordedPayment.findFirst({
      where: { id: paymentId, reservation_id: { in: stay.ids } },
    });
    if (!row) throw ledgerError("Règlement introuvable.", 404);
    if (!row.voided_at)
      await tx.reservationRecordedPayment.update({
        where: { id: row.id },
        data: { voided_at: new Date() },
      });
    await syncManagedContractPayments(id, tx);
    return getReservationPaymentTracking(id, tx);
  });

export const assertLegacyTrackingEditable = async (contract: {
  reservation_id?: string | null;
}) => {
  if (!contract.reservation_id) return;
  const row = await prisma.reservation.findUnique({
    where: { id: contract.reservation_id },
    select: { payments_managed: true },
  });
  if (row?.payments_managed)
    throw ledgerError(
      "Les règlements sont suivis sur la réservation. Ajoutez ou annulez un règlement dans sa fiche pour mettre à jour le contrat.",
    );
};
export { getBookingSource };

export const isManagedReservation = async (
  id?: string | null,
  db: Db = prisma,
) =>
  id
    ? Boolean(
        (
          await db.reservation.findUnique({
            where: { id },
            select: { payments_managed: true },
          })
        )?.payments_managed,
      )
    : false;
export const getContractPaymentContext = (id: string, db: Db = prisma) =>
  db.contrat.findUnique({ where: { id }, include: { gite: true } });
export const setReservationBookingSource = async (
  id: string,
  bookingSource: string,
) => {
  const row = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, stay_group_id: true },
  });
  if (!row) throw ledgerError("Réservation introuvable.", 404);
  await prisma.reservation.updateMany({
    where: row.stay_group_id ? { stay_group_id: row.stay_group_id } : { id },
    data: { booking_source: bookingSource },
  });
  return { id, booking_source: bookingSource };
};
export const hasRecordedPayments = async (id: string, db: Db = prisma) =>
  Boolean(
    await db.reservationRecordedPayment.count({
      where: { reservation_id: id },
    }),
  );
export const moveRecordedPayments = (ids: string[], targetId: string, db: Db) =>
  db.reservationRecordedPayment.updateMany({
    where: { reservation_id: { in: ids } },
    data: { reservation_id: targetId },
  });
export const assertReservationPaymentsDeletable = async (id: string) => {
  const rows = await loadStays([id], prisma);
  if (
    await prisma.reservationRecordedPayment.count({
      where: { reservation_id: { in: rows.map((row) => row.id) } },
    })
  ) {
    throw ledgerError(
      "Cette réservation contient un historique de règlements. Conservez-la pour préserver ce suivi.",
    );
  }
};
