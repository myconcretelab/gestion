import { createHash, randomUUID } from "node:crypto";
import {
  parseAirbnbCsv,
  findOtaRoundingAdjustment,
  type OtaSettlementAdjustment,
  allocateCents,
  type AirbnbRow,
  type OtaAmounts,
  type OtaImportChoice,
  type OtaImportPreview,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";
import {
  prepareReservationPaymentImport,
  syncManagedContractPayments,
  loadReservationPaymentTracking,
} from "../../reservationPayments/ledger.js";
import { extractAirbnbConfirmationCode } from "../../../utils/airbnbReservationIdentity.js";
import { fromJsonString } from "../../../utils/jsonFields.js";

const fail = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
const rowHash = ({ raw: _raw, row: _row, ...data }: AirbnbRow) => hash(data);
const datesMatch = (
  r: { date_entree: Date; date_sortie: Date },
  row: AirbnbRow,
) =>
  (!row.start || r.date_entree.toISOString().slice(0, 10) === row.start) &&
  (!row.end || r.date_sortie.toISOString().slice(0, 10) === row.end);
function relatedStays<
  T extends { id: string; stay_group_id: string | null; date_entree: Date },
>(reservation: T, all: T[]) {
  return all
    .filter(
      (item) =>
        item.id === reservation.id ||
        Boolean(
          reservation.stay_group_id &&
          item.stay_group_id === reservation.stay_group_id,
        ),
    )
    .sort(
      (a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id),
    );
}
async function preview(content: string, db: TenantTransactionClient) {
  let rows: AirbnbRow[];
  try {
    rows = parseAirbnbCsv(content);
  } catch (error) {
    throw fail((error as Error).message, 400);
  }
  const [reservations, existing] = await Promise.all([
    db.reservation.findMany({
      orderBy: [{ date_entree: "desc" }, { id: "asc" }],
      include: {
        gite: { select: { nom: true } },
        recorded_payments: {
          where: { voided_at: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    }),
    db.otaTransaction.findMany({
      where: {
        channel: "Airbnb",
        external_key: { in: rows.map((row) => row.key) },
      },
      include: { recorded_payment: true },
      orderBy: { id: "asc" },
    }),
  ]);
  // Match by stable OTA reference, never by a guest name or amount alone.
  const codeIndex = new Map<string, typeof reservations>();
  for (const reservation of reservations) {
    const code = extractAirbnbConfirmationCode(
      reservation.origin_reference,
      reservation.airbnb_url,
    );
    if (code)
      codeIndex.set(code, [...(codeIndex.get(code) ?? []), reservation]);
  }
  const existingIndex = new Map(existing.map((row) => [row.external_key, row]));
  // Allow explicit corrections even when both the OTA reference and dates differ.
  const candidates = reservations;
  const label = (r: (typeof reservations)[number]) =>
    `${r.hote_nom} · ${r.gite?.nom ?? "Sans logement"} · ${r.date_entree.toISOString().slice(0, 10)}`;
  const tracking = await loadReservationPaymentTracking(
    candidates.map((item) => item.id),
    db,
  );
  const fingerprint = hash({
    tracking: [...tracking],
    rows: rows.map(rowHash),
    reservations: candidates.map((r) => [
      r.id,
      r.updatedAt,
      r.prix_total,
      r.frais_optionnels_montant,
      r.remise_montant,
      r.gite_id,
      r.origin_reference,
      r.airbnb_url,
      r.recorded_payments,
    ]),
    existing,
  });
  const result: OtaImportPreview = {
    fingerprint,
    rows: rows.map((row) => {
      const matches = codeIndex.get(row.code) ?? [];
      const oneGroup =
        matches.length > 1 &&
        matches[0].stay_group_id &&
        matches.every(
          (item) => item.stay_group_id === matches[0].stay_group_id,
        );
      const match =
        matches.length === 1
          ? matches[0]
          : oneGroup
            ? relatedStays(matches[0], reservations)[0]
            : undefined;
      const saved = existingIndex.get(row.key);
      const currentAmount = match
        ? Math.round(
            (tracking.get(match.id)?.platform?.accommodation ??
              relatedStays(match, reservations).reduce(
                (sum, item) => sum + Number(item.prix_total),
                0,
              ) - Number(relatedStays(match, reservations)[0].remise_montant)) *
              100,
          )
        : null;
      const suggestedBasis =
        currentAmount === row.netCents
          ? ("net" as const)
          : currentAmount === row.grossCents
            ? ("gross" as const)
            : null;
      const { raw: _raw, ...data } = row;
      return {
        ...data,
        reservationId: match?.id ?? null,
        reservationLabel: match ? label(match) : "À rattacher",
        existingAmountCents: currentAmount,
        suggestedBasis,
        roundingAdjustment:
          row.type === "reservation" &&
          !saved &&
          match &&
          datesMatch(match, row) &&
          currentAmount !== null
            ? findOtaRoundingAdjustment(
                currentAmount,
                row.grossCents,
                row.netCents,
              )
            : null,
        status: saved
          ? saved.source_hash === rowHash(row) &&
            !saved.recorded_payment?.voided_at
            ? "imported"
            : "conflict"
          : "new",
        warning:
          row.type === "payout"
            ? null
            : !match
              ? "Sélectionnez la réservation."
              : !datesMatch(match, row)
                ? "Les dates du séjour diffèrent."
                : row.type === "resolution"
                  ? "Précisez la catégorie de ce règlement complémentaire."
                  : !suggestedBasis
                    ? "Le prix enregistré diffère du brut et du net. Choisissez le montant affecté au suivi du séjour."
                    : null,
      };
    }),
    reservations: candidates.map((r) => ({
      id: r.id,
      label: label(r),
      amountCents: Math.round(
        (tracking.get(r.id)?.platform?.accommodation ??
          relatedStays(r, reservations).reduce(
            (sum, item) => sum + Number(item.prix_total),
            0,
          ) - Number(relatedStays(r, reservations)[0].remise_montant)) * 100,
      ),
      payments: (tracking.get(r.id)?.entries ?? [])
        .filter(
          (payment) =>
            !payment.voided_at &&
            !payment.ota &&
            payment.origin !== "stripe" &&
            payment.origin !== "platform",
        )
        .map((payment) => ({
          id: payment.id,
          label: `${payment.amount.toFixed(2)} € · ${payment.method ?? "Moyen inconnu"} · ${payment.paid_on?.slice(0, 10) ?? "Sans date"}`,
        })),
    })),
    totals: {
      grossCents: rows
        .filter((row) => row.type !== "payout")
        .reduce((sum, row) => sum + row.grossCents, 0),
      feeCents: rows
        .filter((row) => row.type !== "payout")
        .reduce((sum, row) => sum + row.feeCents, 0),
      netCents: rows
        .filter((row) => row.type === "payout")
        .reduce((sum, row) => sum + row.netCents, 0),
      payouts: rows.filter((row) => row.type === "payout").length,
      reservations: rows.filter((row) => row.type === "reservation").length,
      resolutions: rows.filter((row) => row.type === "resolution").length,
    },
  };
  return { result, rows, reservations };
}
export async function previewOtaImport(content: string) {
  return prisma.$transaction(
    async (db) => (await preview(content, db)).result,
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
export async function applyOtaImport(
  input: {
    content: string;
    fileName: string;
    fingerprint: string;
    choices: OtaImportChoice[];
  },
  userId?: string,
) {
  try {
    return await prisma.$transaction(
      async (db) => {
        const { result, rows, reservations } = await preview(input.content, db);
        if (result.fingerprint !== input.fingerprint)
          throw fail(
            "Les réservations ou les règlements ont changé. Recalculez l’aperçu avant de confirmer.",
          );
        if (
          new Set(input.choices.map((choice) => choice.key)).size !==
            input.choices.length ||
          input.choices.some(
            (choice) =>
              !rows.some(
                (row) => row.key === choice.key && row.type !== "payout",
              ),
          )
        )
          throw fail("Sélections d’import invalides.", 400);
        if (result.rows.some((row) => row.status === "conflict"))
          throw fail(
            "Une référence existe déjà avec des données différentes ou a été annulée. Vérifiez l’historique avant d’importer.",
          );
        const importId = randomUUID();
        let added = 0;
        const roundingAdjustments: Array<
          OtaSettlementAdjustment & {
            key: string;
            reservationId: string;
            reservationLabel: string;
            paymentId: string;
          }
        > = [];
        for (const row of rows) {
          const info = result.rows.find((info) => info.key === row.key)!;
          if (info.status === "imported") continue;
          if (row.grossCents < 0 || row.netCents < 0)
            throw fail(
              "Ce relevé contient un remboursement. Son affectation doit être vérifiée avant l’import.",
              400,
            );
          let reservationId: string | null = null,
            paymentId: string | null = null;
          if (row.type !== "payout") {
            const choice = input.choices.find(
              (choice) => choice.key === row.key,
            );
            reservationId = choice?.reservationId ?? info.reservationId;
            const reservation = reservations.find(
              (item) =>
                item.id === reservationId &&
                result.reservations.some(
                  (candidate) => candidate.id === item.id,
                ),
            );
            if (!reservation || !reservation.gite_id)
              throw fail(
                `Ligne ${row.row} : rattachez ce règlement à une réservation avec logement.`,
                400,
              );
            if (!datesMatch(reservation, row) && !choice)
              throw fail(
                `Ligne ${row.row} : confirmez le rapprochement malgré les dates différentes.`,
                400,
              );
            const category =
              row.type === "reservation" ? "accommodation" : choice?.category;
            if (!category)
              throw fail(
                `Ligne ${row.row} : choisissez la catégorie du règlement complémentaire.`,
                400,
              );
            const basis =
              row.type === "resolution"
                ? "gross"
                : (choice?.settlementBasis ?? info.suggestedBasis);
            if (!basis)
              throw fail(
                `Ligne ${row.row} : choisissez le montant affecté au suivi du séjour.`,
                400,
              );
            const related = relatedStays(reservation, reservations);
            const before = await loadReservationPaymentTracking(
              [reservation.id],
              db,
            );
            const currentAmount = Math.max(
              0,
              Math.round(
                (before.get(reservation.id)?.platform?.accommodation ??
                  related.reduce(
                    (sum, item) => sum + Number(item.prix_total),
                    0,
                  ) - Number(related[0].remise_montant)) * 100,
              ),
            );
            const roundingAdjustment = choice?.regularizeOneCent
              ? findOtaRoundingAdjustment(
                  currentAmount,
                  row.grossCents,
                  row.netCents,
                )
              : null;
            if (
              choice?.regularizeOneCent &&
              (row.type !== "reservation" ||
                choice.settlementBasis !== "reservation" ||
                info.reservationId !== reservation.id ||
                !info.roundingAdjustment ||
                !roundingAdjustment)
            )
              throw fail(
                `Ligne ${row.row} : la régularisation automatique exige un rapprochement confirmé et un écart d’arrondi de 0,01 € avec le brut ou le net.`,
                400,
              );
            const amount =
              basis === "reservation"
                ? currentAmount
                : basis === "gross"
                  ? row.grossCents
                  : row.netCents;
            if (amount <= 0)
              throw fail(`Ligne ${row.row} : montant de règlement nul.`, 400);
            const tracking = await prepareReservationPaymentImport(
              reservation.id,
              db,
            );
            const matchedPayment =
              choice?.paymentId &&
              choice.paymentId !== "new" &&
              tracking.entries.some(
                (entry) =>
                  entry.id === choice.paymentId &&
                  !entry.voided_at &&
                  !entry.ota,
              )
                ? await db.reservationRecordedPayment.findFirst({
                    where: { id: choice.paymentId, voided_at: null },
                  })
                : null;
            if (row.type === "reservation") {
              const already = tracking.entries
                .filter(
                  (entry) =>
                    !entry.voided_at &&
                    entry.origin !== "platform" &&
                    entry.id !== choice?.paymentId &&
                    (entry.ota
                      ? entry.ota.category === "accommodation"
                      : entry.method === "Versement plateforme" ||
                        entry.purpose === "deposit" ||
                        entry.origin === "legacy"),
                )
                .reduce(
                  (sum, entry) => sum + Math.round(entry.amount * 100),
                  0,
                );
              if (already + amount > currentAmount)
                throw fail(
                  `Ligne ${row.row} : le règlement dépasserait le prix enregistré ou ferait doublon. Choisissez le montant du séjour ou rapprochez une saisie existante.`,
                  400,
                );
            }
            const prior = reservation.recorded_payments.filter(
              (payment) =>
                payment.method === "Versement plateforme" &&
                !payment.ota_details,
            );
            if (prior.length && !choice?.paymentId)
              throw fail(
                `Ligne ${row.row} : un versement plateforme est déjà saisi. Choisissez le règlement existant ou confirmez une nouvelle saisie.`,
                400,
              );
            if (
              row.type === "resolution" &&
              amount >
                Math.round(tracking.remaining * 100) +
                  (matchedPayment?.amount_cents ?? 0)
            )
              throw fail(
                `Ligne ${row.row} : ce complément dépasse le reste à payer. Ajoutez d’abord la prestation correspondante au séjour.`,
                400,
              );
            const ota: OtaAmounts = {
              channel: "Airbnb",
              grossCents: row.grossCents,
              feeCents: row.feeCents,
              netCents: row.netCents,
              category,
              source: "import",
              reference: row.payoutReference,
              ...(row.bookingDate ? { bookingDate: row.bookingDate } : {}),
              ...(roundingAdjustment
                ? { settlementAdjustment: roundingAdjustment }
                : {}),
            };
            if (
              related.length > 1 ||
              (row.type === "reservation" && row.cleaningCents)
            ) {
              const weights = related.map((item) =>
                Math.max(
                  0,
                  Math.round(
                    Number(
                      row.type === "reservation"
                        ? item.prix_total
                        : item.frais_optionnels_montant,
                    ) * 100,
                  ),
                ),
              );
              if (!weights.some(Boolean))
                throw fail(
                  `Ligne ${row.row} : renseignez d’abord la prestation dans les logements du séjour.`,
                  400,
                );
              const shares = allocateCents(row.grossCents, weights);
              const cleaning = allocateCents(
                row.type === "reservation" ? row.cleaningCents : 0,
                shares,
              );
              const components = related
                .flatMap((item, i) => [
                  {
                    reservationId: item.id,
                    category,
                    grossCents: shares[i] - cleaning[i],
                  },
                  {
                    reservationId: item.id,
                    category: "cleaning" as const,
                    grossCents: cleaning[i],
                  },
                ])
                .filter((item) => item.grossCents > 0);
              const fees = allocateCents(
                row.feeCents,
                components.map((item) => item.grossCents),
              );
              ota.allocations = components.map((item, i) => ({
                ...item,
                feeCents: fees[i],
                netCents: item.grossCents - fees[i],
              }));
            }
            const data = {
              amount_cents: amount,
              method: "Versement plateforme",
              purpose: category === "accommodation" ? "full" : "extras",
              paid_on: atNoon(row.date),
              note:
                `Import Airbnb · ${row.payoutReference} · date de versement plateforme` +
                (roundingAdjustment
                  ? ` · Écart d’arrondi du suivi : ${roundingAdjustment.adjustmentCents > 0 ? "+" : ""}${(roundingAdjustment.adjustmentCents / 100).toFixed(2).replace(".", ",")} € par rapport au ${roundingAdjustment.basis === "net" ? "net" : "brut"}`
                  : ""),
              ota_details: JSON.stringify(ota),
            };
            if (choice?.paymentId && choice.paymentId !== "new") {
              const existing = matchedPayment;
              if (
                !existing ||
                (existing.amount_cents !== amount &&
                  !(
                    roundingAdjustment &&
                    existing.amount_cents ===
                      roundingAdjustment.sourceAmountCents
                  ))
              )
                throw fail(
                  `Ligne ${row.row} : le règlement à rapprocher est absent ou son montant diffère.`,
                  400,
                );
              paymentId = existing.id;
              await db.reservationRecordedPayment.update({
                where: { id: paymentId },
                data: {
                  ...data,
                  paid_on: existing.paid_on ?? data.paid_on,
                  note: [existing.note, data.note].filter(Boolean).join(" · "),
                  ota_details: JSON.stringify({
                    ...ota,
                    dateSource: existing.paid_on ? "manual" : "platform",
                  }),
                },
              });
            } else {
              paymentId = randomUUID();
              await db.reservationRecordedPayment.create({
                data: {
                  id: paymentId,
                  reservation_id: reservation.id,
                  ...data,
                },
              });
            }
            await syncManagedContractPayments(reservation.id, db);
            if (roundingAdjustment && paymentId)
              roundingAdjustments.push({
                ...roundingAdjustment,
                key: row.key,
                reservationId: reservation.id,
                reservationLabel: info.reservationLabel,
                paymentId,
              });
          }
          await db.otaTransaction.create({
            data: {
              organization_id: getOrganizationId(),
              channel: "Airbnb",
              external_key: row.key,
              import_id: importId,
              source_hash: rowHash(row),
              file_name: input.fileName,
              type: row.type,
              payout_reference: row.payoutReference,
              confirmation_code: row.code,
              paid_on: atNoon(row.date),
              arrival_by: row.arrivalBy ? atNoon(row.arrivalBy) : null,
              gross_cents: row.grossCents,
              fee_cents: row.feeCents,
              net_cents: row.netCents,
              raw_json: JSON.stringify(row.raw),
              reservation_id: reservationId,
              recorded_payment_id: paymentId,
            },
          });
          added++;
        }
        if (added)
          await db.auditLog.create({
            data: {
              organization_id: getOrganizationId(),
              user_id: userId,
              action: "ota.import",
              resource_type: "ota_import",
              resource_id: importId,
              metadata_json: JSON.stringify({
                fileName: input.fileName,
                rows: added,
                totals: result.totals,
                regularized: roundingAdjustments.length,
                roundingAdjustments,
              }),
            },
          });
        return {
          importId,
          added,
          alreadyImported: rows.length - added,
          regularized: roundingAdjustments.length,
        };
      },
      { isolationLevel: "Serializable", timeout: 60000 },
    );
  } catch (error) {
    if (
      ["P2002", "P2034", "P1008", "P2028"].includes(
        (error as { code?: string }).code ?? "",
      )
    )
      throw fail(
        "Un import ou règlement a été enregistré en parallèle. Recalculez l’aperçu.",
      );
    throw error;
  }
}
export async function listOtaImports() {
  const logs = await prisma.auditLog.findMany({
    where: { action: "ota.import" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return logs.map((log) => ({
    id: log.resource_id,
    createdAt: log.createdAt,
    ...fromJsonString<Record<string, unknown>>(log.metadata_json, {}),
  }));
}
