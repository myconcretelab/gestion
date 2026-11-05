import { createHash } from "node:crypto";
import prisma, { type TenantTransactionClient } from "../db/prisma.js";
import { getOrganizationId } from "./organizationContext.js";
import { cleaningTaskReadinessUpdate } from "./cleaningTasks.js";
import { fromJsonString } from "../utils/jsonFields.js";
import type { Prisma } from "@prisma/client";
import { taskUrgencyData } from "./taskUrgency.js";

const reservationSelect = {
  id: true, gite_id: true, date_sortie: true, updatedAt: true,
  arrival_cleaning_checked_at: true, arrival_cleaning_checked_by_user_id: true,
  departure_cleaning_checked_at: true, departure_cleaning_checked_by_user_id: true,
} as const;
type CheckReservation = Prisma.ReservationGetPayload<{ select: typeof reservationSelect }>;

const conflict = (message = "Cette intervention a changé. Fermez puis rouvrez l’annulation.") =>
  Object.assign(new Error(message), { status: 409, code: "CANCELLATION_CONFLICT" });

type CheckSnapshot = {
  checked_at: string;
  task_before: {
    status: string;
    completed_at: string | null;
    completed_by_id: string | null;
    checked_at: string | null;
    checked_by_id: string | null;
  } | null;
  retained_intervention_ids: string[];
};

// Resolve the original source, since an administrator may have corrected the
// displayed kind, gîte or date without changing the operation that created it.
const cancellationPlan = async (database: TenantTransactionClient, id: string) => {
  const entry = await database.userIntervention.findUnique({ where: { id } });
  if (!entry) throw Object.assign(new Error("Intervention introuvable."), { status: 404 });
  if (entry.paid_at) throw conflict("Cette intervention est déjà payée. Corrigez d’abord son état dans l’historique.");
  const entries = [entry];
  const reservations: { before: CheckReservation; field: "arrival" | "departure" }[] = [];
  const effects: string[] = [];
  let cleaningChange: {
    before: NonNullable<Awaited<ReturnType<typeof database.cleaningTask.findUnique>>>;
    data: ReturnType<typeof cleaningTaskReadinessUpdate>;
  } | null = null;
  let actionChange: NonNullable<Awaited<ReturnType<typeof database.actionTask.findUnique>>> | null = null;
  const source = entry.source_key ?? "";
  const isCheck = source.startsWith("cleaning-check:");
  const isCleaning = source.startsWith("full-cleaning:") && entry.automatic;

  if (isCheck || isCleaning) {
    const departureId = source.slice(source.indexOf(":") + 1);
    const reservation = await database.reservation.findUnique({ where: { id: departureId }, select: reservationSelect });
    const task = await database.cleaningTask.findFirst({ where: { departure_reservation_id: departureId } });
    const checkedAt = reservation?.departure_cleaning_checked_at ?? (isCheck ? reservation?.arrival_cleaning_checked_at : null);
    let snapshot: CheckSnapshot | null = null;
    if (checkedAt) {
      const audit = await database.auditLog.findFirst({
        where: { action: "gite_cleaning.checked", resource_id: departureId },
        orderBy: { createdAt: "desc" },
      });
      const value = fromJsonString<CheckSnapshot | null>(audit?.metadata_json, null);
      if (value?.checked_at === checkedAt.toISOString()) snapshot = value;
    }
    if (reservation && checkedAt) {
      const field = reservation.departure_cleaning_checked_at ? "departure" : "arrival";
      reservations.push({ before: reservation, field });
      if (field === "departure" && reservation.gite_id) {
        const arrivals = await database.reservation.findMany({ where: {
          id: { not: reservation.id }, gite_id: reservation.gite_id,
          date_entree: { gte: reservation.date_sortie }, arrival_cleaning_checked_at: checkedAt,
        }, select: reservationSelect, orderBy: { id: "asc" } });
        reservations.push(...arrivals.map((before) => ({ before, field: "arrival" as const })));
      }
      effects.push("Le gîte repasse à contrôler ; la validation de l’arrivée liée est retirée.");
    }
    const directCompletion = !task || Boolean(task.completed_at && task.checked_at
      && task.completed_at.getTime() === task.checked_at.getTime());
    if (task && (isCleaning || task.checked_at)) {
      const data = isCleaning
        ? { status: "planned", completed_at: null, completed_by_id: null, checked_at: null, checked_by_id: null }
        : snapshot?.task_before
          ? {
              ...snapshot.task_before,
              completed_at: snapshot.task_before.completed_at ? new Date(snapshot.task_before.completed_at) : null,
              checked_at: snapshot.task_before.checked_at ? new Date(snapshot.task_before.checked_at) : null,
            }
          : cleaningTaskReadinessUpdate(task, false, null, null);
      cleaningChange = { before: task, data };
      effects.push(data.status === "done" ? "Le ménage reste terminé, en attente de contrôle."
        : data.status === "in_progress" ? "Le ménage reprend son état « En cours »." : "Le ménage revient dans les tâches à faire.");
    }
    const related = await database.userIntervention.findMany({ where: {
      source_key: { in: [`cleaning-check:${departureId}`, `full-cleaning:${departureId}`] },
      id: { not: entry.id },
    }, orderBy: { id: "asc" } });
    for (const item of related) {
      const remove = isCleaning || (item.automatic && (snapshot
        ? !snapshot.retained_intervention_ids.includes(item.id) : directCompletion));
      if (remove) entries.push(item);
    }
  } else if (source.startsWith("action-task:")) {
    const task = await database.actionTask.findUnique({ where: { id: source.slice("action-task:".length) } });
    if (task?.status === "done") {
      actionChange = task;
      effects.push(`La tâche « ${task.title} » revient dans les tâches à faire.`);
    }
  }
  if (entries.some((item) => item.paid_at)) {
    throw conflict("Une intervention liée est déjà payée. Corrigez d’abord son état dans l’historique.");
  }
  if (!effects.length) effects.push("La ligne est retirée de l’historique et des montants à payer.");
  const plan = { entry, entries, reservations, cleaningChange, actionChange, effects };
  const fingerprint = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return { ...plan, fingerprint };
};

export const previewInterventionCancellation = async (id: string) => {
  const plan = await cancellationPlan(prisma, id);
  return {
    fingerprint: plan.fingerprint,
    effects: plan.effects,
    amount: plan.entries.reduce((sum, item) => sum + Number(item.amount_snapshot), 0),
    entries: plan.entries.map((item) => ({ id: item.id, kind: item.kind, amount: Number(item.amount_snapshot) })),
  };
};

export const cancelIntervention = async (
  id: string,
  payload: { reason: string; expectedUpdatedAt: string; fingerprint: string },
  actor: { userId: string | null; requestId: string | null },
) => prisma.$transaction(async (tx) => {
  const plan = await cancellationPlan(tx, id);
  if (plan.entry.updatedAt.toISOString() !== payload.expectedUpdatedAt || plan.fingerprint !== payload.fingerprint) throw conflict();
  for (const { before, field } of plan.reservations) {
    const timestamp = field === "departure" ? "departure_cleaning_checked_at" : "arrival_cleaning_checked_at";
    const user = field === "departure" ? "departure_cleaning_checked_by_user_id" : "arrival_cleaning_checked_by_user_id";
    const changed = await tx.reservation.updateMany({
      where: { id: before.id, updatedAt: before.updatedAt, [timestamp]: before[timestamp] },
      data: { [timestamp]: null, [user]: null },
    });
    if (changed.count !== 1) throw conflict();
  }
  if (plan.cleaningChange) {
    const { before, data } = plan.cleaningChange;
    const changed = await tx.cleaningTask.updateMany({ where: { id: before.id, updatedAt: before.updatedAt }, data });
    if (changed.count !== 1) throw conflict();
  }
  if (plan.actionChange) {
    const changed = await tx.actionTask.updateMany({
      where: { id: plan.actionChange.id, updatedAt: plan.actionChange.updatedAt },
      data: { status: "planned", completed_at: null, completed_by_id: null, ...taskUrgencyData(0) },
    });
    if (changed.count !== 1) throw conflict();
  }
  for (const entry of plan.entries) {
    const removed = await tx.userIntervention.deleteMany({ where: { id: entry.id, paid_at: null, updatedAt: entry.updatedAt } });
    if (removed.count !== 1) throw conflict();
  }
  await tx.auditLog.create({ data: {
    organization_id: getOrganizationId(), user_id: actor.userId, request_id: actor.requestId,
    action: "user_intervention.cancelled", resource_type: "user_intervention", resource_id: id,
    metadata_json: JSON.stringify({ reason: payload.reason, before: {
      entries: plan.entries, reservations: plan.reservations,
      cleaning_task: plan.cleaningChange?.before ?? null, action_task: plan.actionChange,
    }, after: {
      removed_ids: plan.entries.map((entry) => entry.id), effects: plan.effects,
      reservations: plan.reservations.map(({ before, field }) => ({ id: before.id, occurrence: field, checked_at: null, checked_by_user_id: null })),
      cleaning_task: plan.cleaningChange?.data ?? null,
      action_task: plan.actionChange ? { id: plan.actionChange.id, status: "planned", completed_at: null, completed_by_id: null } : null,
    } }),
  } });
  return { removed_ids: plan.entries.map((entry) => entry.id), effects: plan.effects };
});
