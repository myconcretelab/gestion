import { createHash } from "node:crypto";
import {
  createTouristTaxStayForSource,
  getBookingSource,
  parseTouristTaxSettings,
  reservationAmountToCollect,
  reservationTouristTax,
  touristTaxReapplySchema,
  type TouristTaxReapplyAmounts,
  type TouristTaxReapplyInput,
  type TouristTaxReapplyPreview,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../db/prisma.js";
import { fromJsonString } from "../../utils/jsonFields.js";
import type { OptionsInput } from "../../services/contractCalculator.js";
import { readTouristTaxCollectionSettings } from "../../services/touristTaxCollection.js";
import { getOrganizationId } from "../organizations/context.js";

const fail = (message: string) =>
  Object.assign(new Error(message), { statusCode: 409 });
async function prepare(
  input: TouristTaxReapplyInput,
  db: TenantTransactionClient,
) {
  const selected = await db.reservation.findMany({
    where: {
      date_entree: {
        gte: new Date(input.from),
        lt: new Date(`${input.to}T23:59:59.999Z`),
      },
      ...(input.gite_id ? { gite_id: input.gite_id } : {}),
    },
    include: { gite: true },
    orderBy: [{ date_entree: "asc" }, { id: "asc" }],
  });
  if (selected.length > 2000)
    throw fail(
      "Plus de 2 000 segments : réduisez la période ou choisissez un gîte.",
    );
  const groupIds = [
    ...new Set(
      selected
        .map((row) => row.stay_group_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const siblings = groupIds.length
    ? await db.reservation.findMany({
        where: { stay_group_id: { in: groupIds } },
        include: { gite: true },
        orderBy: [{ date_entree: "asc" }, { id: "asc" }],
      })
    : [];
  const reservations = [
    ...new Map([...selected, ...siblings].map((row) => [row.id, row])).values(),
  ].sort((a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id));
  const ids = reservations.map((row) => row.id);
  const [collection, contracts, invoices, links, pending] = await Promise.all([
    readTouristTaxCollectionSettings(db),
    db.contrat.findMany({
      where: { reservation_id: { in: ids } },
      select: { id: true, reservation_id: true },
      orderBy: { id: "asc" },
    }),
    db.facture.findMany({
      where: {
        OR: [
          { reservation_id: { in: ids } },
          { reservation_items: { not: "[]" } },
        ],
      },
      select: { id: true, reservation_id: true, reservation_items: true },
      orderBy: { id: "asc" },
    }),
    db.reservationPaymentLink.findMany({
      where: { reservation_id: { in: ids }, status: "active" },
      select: { id: true, reservation_id: true },
      orderBy: { id: "asc" },
    }),
    db.bookingPayment.findMany({
      where: {
        OR: [
          { reservation_id: { in: ids } },
          { booking_request: { is: { approved_reservation_id: { in: ids } } } },
        ],
        status: { in: ["creating", "pending"] },
      },
      select: {
        id: true,
        reservation_id: true,
        booking_request: { select: { approved_reservation_id: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        input,
        reservations,
        collection,
        contracts,
        invoices,
        links,
        pending,
      }),
    )
    .digest("hex");
  const groups = new Map<string, typeof reservations>();
  for (const row of reservations)
    groups.set(row.stay_group_id || row.id, [
      ...(groups.get(row.stay_group_id || row.id) ?? []),
      row,
    ]);
  const changes: Array<{ ids: string[]; options: string }> = [];
  const rows: TouristTaxReapplyPreview["rows"] = [];
  for (const segments of groups.values()) {
    const first = segments[0];
    const groupRowIds = segments.map((row) => row.id);
    const options = fromJsonString<OptionsInput>(first.options, {});
    const previous = options.tourist_tax;
    const source = getBookingSource(first);
    const policy = parseTouristTaxSettings(first.gite?.taxe_sejour_config);
    const start = first.date_entree.toISOString().slice(0, 10);
    const totalPrice = segments.reduce(
      (sum, row) => sum + Number(row.prix_total),
      0,
    );
    const combined = {
      ...first,
      prix_total: totalPrice,
      nb_nuits: segments.reduce((sum, row) => sum + row.nb_nuits, 0),
      frais_optionnels_montant: segments.reduce(
        (sum, row) => sum + Number(row.frais_optionnels_montant),
        0,
      ),
    };
    const amounts = (value: OptionsInput): TouristTaxReapplyAmounts => {
      const tax = reservationTouristTax({ ...combined, options: value });
      return {
        collector: tax?.collector ?? "unknown",
        platform: tax?.platform ?? "",
        included: tax?.included ?? null,
        tax: tax && tax.collector !== "unknown" ? tax.amount : null,
        total: reservationAmountToCollect({ ...combined, options: value }),
        accommodation:
          tax?.accommodation_amount ??
          Math.max(0, totalPrice - Number(first.remise_montant)),
      };
    };
    const before = amounts(options);
    let next = policy
      ? createTouristTaxStayForSource(policy, source, collection)
      : previous;
    if (next && previous) {
      next = {
        ...next,
        infants: previous.infants,
        exempt_adults: previous.exempt_adults,
        exemption_reason: previous.exemption_reason,
      };
      if (!input.override_manual) {
        if (
          previous.collector_mode === "manual" ||
          (!previous.collector_mode && previous.collector !== "unknown")
        )
          next = {
            ...next,
            collector: previous.collector,
            platform: previous.platform,
            collector_mode: "manual",
          };
        if (
          previous.price_mode === "manual" ||
          (!previous.price_mode && previous.collector !== "unknown")
        )
          next = {
            ...next,
            settings: {
              ...next.settings,
              included: previous.settings.included,
            },
            price_mode: "manual",
          };
      }
    }
    const afterOptions = { ...options, ...(next ? { tourist_tax: next } : {}) };
    const after = amounts(afterOptions);
    const tax = next
      ? reservationTouristTax({ ...combined, options: afterOptions })
      : null;
    let reason: string | null = !policy
      ? "Barème du gîte non configuré"
      : start < input.from || start > input.to
        ? "Première arrivée hors de la période"
        : segments.some((row) => row.gite_id !== first.gite_id)
          ? "Séjour réparti sur plusieurs gîtes"
          : null;
    if (
      contracts.some(
        (row) => row.reservation_id && groupRowIds.includes(row.reservation_id),
      ) ||
      invoices.some(
        (row) =>
          (row.reservation_id && groupRowIds.includes(row.reservation_id)) ||
          groupRowIds.some((id) =>
            row.reservation_items.includes(JSON.stringify(id)),
          ),
      )
    )
      reason = "Contrat ou facture déjà enregistré";
    else if (
      links.some((row) => groupRowIds.includes(row.reservation_id)) ||
      pending.some((row) =>
        groupRowIds.includes(
          row.reservation_id ||
            row.booking_request?.approved_reservation_id ||
            "",
        ),
      )
    )
      reason = "Lien actif ou paiement en cours";
    if (!reason && tax?.issues.length) reason = tax.issues.join(" ");
    if (!reason && JSON.stringify(previous) === JSON.stringify(next))
      reason = "Déjà à jour";
    const eligible = !reason;
    rows.push({
      id: first.id,
      guest: first.hote_nom,
      gite: first.gite?.nom ?? "Sans gîte",
      start,
      source,
      before,
      after: eligible ? after : before,
      eligible,
      reason,
    });
    if (eligible && next)
      for (const segment of segments) {
        const ownOptions = fromJsonString<OptionsInput>(segment.options, {});
        changes.push({
          ids: [segment.id],
          options: JSON.stringify({ ...ownOptions, tourist_tax: next }),
        });
      }
  }
  return {
    preview: {
      fingerprint,
      rows,
      eligible: rows.filter((row) => row.eligible).length,
      excluded: rows.filter((row) => !row.eligible).length,
    },
    changes,
  };
}
export async function previewTouristTaxReapply(
  value: unknown,
): Promise<TouristTaxReapplyPreview> {
  const input = touristTaxReapplySchema.parse(value);
  return prisma.$transaction(async (db) => (await prepare(input, db)).preview, {
    isolationLevel: "Serializable",
    timeout: 30_000,
  });
}
export async function applyTouristTaxReapply(value: unknown, userId?: string) {
  const raw = value as Record<string, unknown>;
  if (!raw || typeof raw.fingerprint !== "string")
    throw fail("Prévisualisez les changements avant de les appliquer.");
  const { fingerprint, ...scope } = raw;
  const input = touristTaxReapplySchema.parse(scope);
  return prisma.$transaction(
    async (db) => {
      const { preview, changes } = await prepare(input, db);
      if (fingerprint !== preview.fingerprint)
        throw fail(
          "Les réservations ou les règles ont changé. Prévisualisez à nouveau les changements.",
        );
      for (const change of changes)
        await db.reservation.updateMany({
          where: { id: { in: change.ids } },
          data: { options: change.options },
        });
      if (changes.length)
        await db.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            user_id: userId,
            action: "tourist_tax.reapply",
            resource_type: "reservation",
            resource_id: "period",
            metadata_json: JSON.stringify({
              scope: input,
              changes: preview.rows.filter((row) => row.eligible),
            }),
          },
        });
      return { updated: preview.eligible };
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
