// One-off, tenant-scoped repair requested by the installation owner.
// Build the server first. Preview by default; --apply writes a protected rollback snapshot.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const root = process.cwd();
const fromRoot = (file) => import(pathToFileURL(path.join(root, file)).href);
const { default: prisma, systemPrisma } = await fromRoot(
  "server/dist/db/prisma.js",
);
const { loadReservationPaymentTracking, syncManagedContractPayments } =
  await fromRoot("server/dist/modules/reservationPayments/ledger.js");
const { legacyPaymentMethod } = await fromRoot(
  "packages/shared/dist/src/index.js",
);
const organizationId = "org_historical_broceliande";
// An October 1 departure has no occupied night in October.
const cutoff = new Date("2026-10-01T00:00:00Z");
const cents = (value) => Math.round(Number(value) * 100);
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dateAfterDeparture = (rows) => {
  const last = Math.max(...rows.map((row) => +row.date_sortie));
  const date = new Date(last);
  date.setUTCDate(date.getUTCDate() + 2);
  date.setUTCHours(12, 0, 0, 0);
  return date;
};
const snapshot = async (db) => {
  const reservations = await db.reservation.findMany({
    where: {
      organization_id: organizationId,
      gite_id: { not: null },
      date_sortie: { lte: cutoff },
    },
    orderBy: { id: "asc" },
  });
  const ids = reservations.map((row) => row.id);
  const [payments, contracts] = await Promise.all([
    db.reservationRecordedPayment.findMany({
      where: { organization_id: organizationId, reservation_id: { in: ids } },
      orderBy: { id: "asc" },
    }),
    db.contrat.findMany({
      where: { organization_id: organizationId, reservation_id: { in: ids } },
      orderBy: { id: "asc" },
    }),
  ]);
  return { reservations, payments, contracts };
};

try {
  const before = await snapshot(prisma);
  const ids = before.reservations.map((row) => row.id);
  const siblings = await prisma.reservation.count({
    where: {
      stay_group_id: {
        in: before.reservations.map((row) => row.stay_group_id).filter(Boolean),
      },
      id: { notIn: ids },
    },
  });
  if (siblings)
    throw new Error(
      "A stay crosses the repair scope; inspect its split reservations first.",
    );
  const tracking = await loadReservationPaymentTracking(ids);
  const gites = await prisma.gite.findMany({ select: { id: true, nom: true } });
  const existing = new Map(before.payments.map((row) => [row.id, row]));
  const groups = new Map();
  for (const row of before.reservations) {
    const key = row.stay_group_id ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const creates = [],
    updates = [],
    managedIds = [],
    expectations = [];
  const byGite = {};
  let zeroTotal = 0,
    preservedDates = 0,
    remainingCents = 0;
  for (const rows of groups.values()) {
    rows.sort(
      (a, b) => +a.date_entree - +b.date_entree || a.id.localeCompare(b.id),
    );
    const first = rows[0],
      state = tracking.get(first.id);
    if (state.requires_review || state.overpaid > 0)
      throw new Error(`Payment review required for ${first.id}.`);
    if (state.total <= 0) {
      zeroTotal++;
      continue;
    }
    const target = dateAfterDeparture(rows);
    const note = `Reprise historique demandée le 02/11/2026 : séjour confirmé payé par le propriétaire ; date reconstituée à deux jours après la sortie (${target.toISOString().slice(0, 10)}), sans justificatif d’encaissement à cette date.`;
    const gite = gites.find((g) => g.id === first.gite_id).nom;
    const stats = (byGite[gite] ??= {
      reservations: 0,
      newReceipts: 0,
      datesCorrected: 0,
      previouslyUnrecordedCents: 0,
    });
    stats.reservations += rows.length;
    managedIds.push(...rows.map((row) => row.id));
    for (const entry of state.entries.filter((entry) => !entry.voided_at)) {
      if (entry.origin === "stripe" || entry.ota?.source === "import") {
        preservedDates++;
        continue;
      }
      // Preserve the actual dated deposit already recorded before the cutoff.
      const preserve =
        entry.origin === "legacy" &&
        entry.purpose === "deposit" &&
        entry.paid_on &&
        !entry.paid_on_estimated &&
        new Date(entry.paid_on) < cutoff;
      const paidOn = preserve ? new Date(entry.paid_on) : target;
      if (preserve) preservedDates++;
      const record = existing.get(entry.id);
      if (record) {
        if (!state.managed)
          throw new Error(
            `Unmanaged stored receipt requires inspection: ${entry.id}`,
          );
        if (record.paid_on?.toISOString() !== paidOn.toISOString()) {
          updates.push({
            id: record.id,
            paid_on: paidOn,
            note: [record.note, note].filter(Boolean).join("\n"),
          });
          stats.datesCorrected++;
        }
      } else {
        creates.push({
          id: entry.id,
          organization_id: organizationId,
          reservation_id: first.id,
          amount_cents: cents(entry.amount),
          method: entry.method,
          purpose: entry.purpose,
          paid_on: paidOn,
          origin: entry.origin === "legacy" ? "legacy" : "manual",
          note: preserve
            ? entry.note
            : [entry.note, note].filter(Boolean).join("\n"),
          ota_details: entry.ota ? JSON.stringify(entry.ota) : null,
        });
        stats.newReceipts++;
      }
      expectations.push({ id: entry.id, date: paidOn.toISOString() });
    }
    if (state.remaining > 0) {
      const amount = cents(state.remaining);
      const id = randomUUID();
      creates.push({
        id,
        organization_id: organizationId,
        reservation_id: first.id,
        amount_cents: amount,
        // Keep an unknown payment method unknown rather than inventing cash or a transfer.
        method: legacyPaymentMethod(first.source_paiement),
        purpose: state.received > 0 ? "balance" : "full",
        paid_on: target,
        origin: "manual",
        note,
        ota_details: null,
      });
      expectations.push({ id, date: target.toISOString() });
      remainingCents += amount;
      stats.newReceipts++;
      stats.previouslyUnrecordedCents += amount;
    }
  }
  const plan = {
    cutoff: cutoff.toISOString(),
    byGite,
    reservations: managedIds.length,
    zeroTotal,
    preservedDates,
    creates,
    updates,
    expectations,
    remainingCents,
  };
  const summary = {
    cutoff: plan.cutoff,
    byGite,
    reservations: plan.reservations,
    zeroTotal,
    preservedDates,
    newReceipts: creates.length,
    datesCorrected: updates.length,
    previouslyUnrecordedCents: remainingCents,
  };
  console.log(
    JSON.stringify({
      mode: process.argv.includes("--apply") ? "apply" : "preview",
      ...summary,
    }),
  );
  if (process.argv.includes("--apply")) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = path.join(
      root,
      "server/data/backups",
      `historical-payment-dates-${stamp}`,
    );
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const backupFile = path.join(directory, "before.json");
    const cache = await prisma.financeReportCache.findFirst();
    const store = await prisma.financeReportStore.findFirst();
    fs.writeFileSync(
      backupFile,
      JSON.stringify({
        createdAt: new Date(),
        organizationId,
        before,
        plan,
        cache,
        store,
      }),
      { mode: 0o600, flag: "wx" },
    );
    // Verify the rollback snapshot is intact before writing any business data.
    if (
      fingerprint(JSON.parse(fs.readFileSync(backupFile, "utf8")).before) !==
      fingerprint(JSON.parse(JSON.stringify(before)))
    )
      throw new Error("Backup verification failed.");
    await prisma.$transaction(
      async (tx) => {
        const current = await snapshot(tx);
        if (fingerprint(current) !== fingerprint(before))
          throw new Error(
            "Source data changed; no repair was applied. Preview again.",
          );
        const pending = await tx.bookingPayment.count({
          where: {
            status: { in: ["creating", "pending"] },
            OR: [
              { reservation_id: { in: managedIds } },
              {
                booking_request: {
                  is: { approved_reservation_id: { in: managedIds } },
                },
              },
            ],
          },
        });
        if (pending)
          throw new Error("A card payment is in progress in the repair scope.");
        await tx.reservation.updateMany({
          where: { id: { in: managedIds } },
          data: { payments_managed: true },
        });
        for (let i = 0; i < creates.length; i += 250)
          await tx.reservationRecordedPayment.createMany({
            data: creates.slice(i, i + 250),
          });
        for (const { id, ...data } of updates)
          await tx.reservationRecordedPayment.update({ where: { id }, data });
        for (const id of new Set(
          before.contracts
            .map((row) => row.reservation_id)
            .filter((id) => managedIds.includes(id)),
        ))
          await syncManagedContractPayments(id, tx);
        const after = await loadReservationPaymentTracking(ids, tx);
        for (const rows of groups.values()) {
          const id = rows[0].id,
            old = tracking.get(id),
            state = after.get(id);
          if (
            cents(old.total) !== cents(state.total) ||
            state.remaining !== 0 ||
            state.overpaid !== 0
          )
            throw new Error(`Balance verification failed for ${id}.`);
        }
        const actual = new Map(
          [...after.values()].flatMap((state) =>
            state.entries.map((entry) => [entry.id, entry]),
          ),
        );
        for (const expectation of expectations)
          if (actual.get(expectation.id)?.paid_on !== expectation.date)
            throw new Error(`Date verification failed for ${expectation.id}.`);
        for (const row of before.payments) {
          const state = await tx.reservationRecordedPayment.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (
            state.amount_cents !== row.amount_cents ||
            state.method !== row.method ||
            state.voided_at?.toISOString() !== row.voided_at?.toISOString()
          )
            throw new Error(`Original payment changed unexpectedly: ${row.id}`);
        }
        await tx.auditLog.create({
          data: {
            organization_id: organizationId,
            action: "reservation.historical-payment-dates.reconcile",
            resource_type: "reservation",
            resource_id: "before-2026-10",
            metadata_json: JSON.stringify({
              ...summary,
              backupFile,
              newPaymentIds: creates.map((row) => row.id),
              updatedPaymentIds: updates.map((row) => row.id),
              datePolicy: "departure-plus-two-days-estimate",
              authorization:
                "Owner confirmed historical stays already paid and requested this reconstructed date.",
            }),
          },
        });
      },
      { isolationLevel: "Serializable", timeout: 180000 },
    );
    fs.writeFileSync(
      path.join(directory, "completed.json"),
      JSON.stringify({ completedAt: new Date(), ...summary }),
      { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify({ completed: true, backupFile, ...summary }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await systemPrisma.$disconnect();
}
