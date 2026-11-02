import { createHash } from "node:crypto";
import {
  AUTOMATIC_PAYMENT_PLATFORMS,
  OTA_OPTION_KEYS,
  allocateCents,
  allocateOtaPriceRows,
  calculateOtaPrice,
  getBookingSource,
  otaPriceInputSchema,
  otaRate,
  validOtaPriceSnapshot,
  type OtaPricingContext,
  type OtaOptionKey,
} from "@contrats/shared";
import { z } from "zod";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { encodeJsonField, fromJsonString } from "../../utils/jsonFields.js";
import type { OptionsInput } from "../../services/contractCalculator.js";
import { readReservationPaymentSettings } from "../../services/reservationPaymentSettings.js";
import { getOrganizationId } from "../../services/organizationContext.js";
import { ledgerError } from "./ledger.js";

const inputSchema = otaPriceInputSchema
  .extend({ revision: z.string().min(1) })
  .strict();
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const labels: Record<OtaOptionKey, string> = {
  menage: "Ménage",
  draps: "Draps",
  linge_toilette: "Linge de toilette",
  depart_tardif: "Départ tardif",
  chiens: "Animaux",
};
async function read(id: string, db: TenantTransactionClient) {
  const selected = await db.reservation.findFirst({ where: { id } });
  if (!selected) throw ledgerError("Réservation introuvable.", 404);
  const rows = await db.reservation.findMany({
    where: selected.stay_group_id
      ? { stay_group_id: selected.stay_group_id }
      : { id },
    include: { gite: true },
    orderBy: [{ date_entree: "asc" }, { id: "asc" }],
  });
  const first = rows[0],
    ids = rows.map((row) => row.id);
  const settings = await readReservationPaymentSettings(db);
  const source = getBookingSource(first);
  const channel = settings.platforms?.find((item) => item.name === source);
  if (
    !channel &&
    !(AUTOMATIC_PAYMENT_PLATFORMS as readonly string[]).includes(source)
  )
    throw ledgerError(
      "Choisissez une plateforme comme origine de la réservation.",
      400,
    );
  const options = fromJsonString<OptionsInput>(first.options, {});
  const arrival = first.date_entree.toISOString().slice(0, 10);
  const estimatedPayment = new Date(first.date_entree);
  estimatedPayment.setUTCDate(estimatedPayment.getUTCDate() + 1);
  const rateDay =
    channel?.rateDateBasis === "booking"
      ? null
      : channel?.rateDateBasis === "arrival"
        ? arrival
        : estimatedPayment.toISOString().slice(0, 10);
  const rate = rateDay ? otaRate(channel, rateDay) : undefined;
  const percent = rate?.percent;
  const prices: Record<OtaOptionKey, number> = {
    menage: cents(first.gite?.options_menage_forfait),
    draps:
      cents(options.draps?.prix_unitaire ?? first.gite?.options_draps_par_lit) *
      (options.draps?.nb_lits ?? 0),
    linge_toilette:
      cents(first.gite?.options_linge_toilette_par_personne) *
      (options.linge_toilette?.nb_personnes ?? 0),
    depart_tardif: cents(
      options.depart_tardif?.prix_forfait ??
        first.gite?.options_depart_tardif_forfait,
    ),
    chiens:
      cents(
        options.chiens?.prix_unitaire ?? first.gite?.options_chiens_forfait,
      ) *
      (options.chiens?.nb ?? 1) *
      rows.reduce((n, row) => n + row.nb_nuits, 0),
  };
  const recorded = await db.reservationRecordedPayment.count({
    where: { reservation_id: { in: ids }, voided_at: null },
  });
  const card = await db.bookingPayment.count({
    where: {
      OR: [
        { reservation_id: { in: ids } },
        { booking_request: { is: { approved_reservation_id: { in: ids } } } },
      ],
      status: { notIn: ["canceled", "expired", "failed"] },
    },
  });
  const documents =
    (await db.contrat.count({ where: { reservation_id: { in: ids } } })) +
    (await db.facture.count({ where: { reservation_id: { in: ids } } }));
  const gross =
    rows.reduce((n, row) => n + cents(row.prix_total), 0) -
    cents(first.remise_montant);
  const valid = validOtaPriceSnapshot(
    options.ota_price,
    gross,
    options,
    source,
  );
  const context: OtaPricingContext = {
    source,
    amountCents: gross,
    revision: createHash("sha256")
      .update(
        JSON.stringify([
          rows.map((row) => [
            row.id,
            row.updatedAt,
            row.options,
            row.prix_total,
            row.frais_optionnels_montant,
          ]),
          settings,
        ]),
      )
      .digest("hex"),
    rule: {
      ...(percent !== undefined
        ? { percent, effectiveFrom: rate!.effectiveFrom }
        : {}),
      rounding: channel?.commissionRounding ?? "cent",
      scope: channel?.commissionScope ?? "all",
    },
    options: OTA_OPTION_KEYS.map((key) => ({
      key,
      label: labels[key],
      enabled: Boolean(options[key]?.enabled),
      included: Boolean(
        options[key]?.enabled && options[key]?.inclus && !options[key]?.offert,
      ),
      amountCents:
        options[key]?.inclus && options[key]?.montant_inclus !== undefined
          ? cents(options[key]?.montant_inclus)
          : prices[key],
    })),
    ...(valid ? { saved: options.ota_price } : {}),
    ...(recorded || card || documents
      ? {
          blockedReason:
            "Ce séjour possède déjà un règlement ou un document. Corrigez ses montants depuis le séjour et conservez les montants réels du règlement.",
        }
      : {}),
  };
  return { context, rows, options, prices };
}
export const getOtaPricing = async (id: string) =>
  (await read(id, prisma)).context;

export async function saveOtaPricing(id: string, input: unknown) {
  const payload = inputSchema.parse(input);
  await prisma.$transaction(async (db) => {
    const { context, rows, options, prices } = await read(id, db);
    if (context.revision !== payload.revision)
      throw ledgerError(
        "La réservation ou les règles ont changé. Rechargez les montants avant d’enregistrer.",
      );
    if (context.blockedReason) throw ledgerError(context.blockedReason);
    let snapshot;
    try {
      snapshot = calculateOtaPrice(
        {
          basis: payload.basis,
          amountCents: payload.amountCents,
          ...(payload.feeCents !== undefined
            ? { feeCents: payload.feeCents }
            : {}),
          included: payload.included,
        },
        context.rule,
      );
    } catch (error) {
      throw ledgerError(
        error instanceof Error ? error.message : "Calcul impossible.",
        400,
      );
    }
    let fees = rows.reduce(
      (n, row) => n + cents(row.frais_optionnels_montant),
      0,
    );
    for (const key of OTA_OPTION_KEYS) {
      const old = options[key];
      const included = payload.included[key] > 0;
      if (included && old?.enabled && !old.offert && !old.inclus) {
        if (fees < payload.included[key])
          throw ledgerError(
            "Le montant des suppléments ne permet pas cette conversion. Vérifiez les options du séjour.",
            400,
          );
        fees -= payload.included[key];
      } else if (!included && old?.enabled && old.inclus && !old.offert) {
        fees += cents(old.montant_inclus ?? prices[key] / 100);
      }
      if (included || old)
        options[key] = {
          ...old,
          enabled: included || Boolean(old?.enabled),
          inclus: included,
          ...(included
            ? { offert: false, montant_inclus: payload.included[key] / 100 }
            : {}),
        };
    }
    // All three input choices explicitly exclude tourist tax.
    if (options.tourist_tax)
      options.tourist_tax = {
        ...options.tourist_tax,
        settings: { ...options.tourist_tax.settings, included: false },
      };
    options.ota_price = { ...snapshot, channel: context.source };
    const weights = rows.map((row) => Math.max(1, row.nb_nuits));
    const grossParts = allocateCents(snapshot.grossCents, weights);
    const feeParts = allocateCents(fees, weights);
    const categories = allocateOtaPriceRows(snapshot, grossParts).gross;
    const draps = allocateCents(snapshot.included.draps, categories[2]);
    const late = allocateCents(snapshot.included.depart_tardif, categories[3]);
    for (const [i, row] of rows.entries()) {
      // A conditional write also serializes concurrent card/payment creation against this stay.
      const updated = await db.reservation.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: {
          prix_total: grossParts[i] / 100,
          prix_par_nuit: Math.round(grossParts[i] / row.nb_nuits) / 100,
          remise_montant: 0,
          frais_optionnels_montant: feeParts[i] / 100,
          options: encodeJsonField({
            ...options,
            ota_price: {
              ...options.ota_price,
              rowGrossCents: grossParts[i],
              rowIncluded: {
                menage: categories[1][i],
                draps: draps[i],
                linge_toilette: categories[2][i] - draps[i],
                depart_tardif: late[i],
                chiens: categories[3][i] - late[i],
              },
            },
          }),
        },
      });
      if (updated.count !== 1)
        throw ledgerError(
          "Le séjour a changé pendant l’enregistrement. Rechargez ses montants.",
        );
    }
    await db.auditLog.create({
      data: {
        organization_id: getOrganizationId(),
        resource_type: "reservation",
        resource_id: rows[0].id,
        action: "ota.pricing",
        metadata_json: JSON.stringify({ input: payload, result: snapshot }),
      },
    });
  });
  return getOtaPricing(id);
}
