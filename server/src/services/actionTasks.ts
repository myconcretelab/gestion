import prisma, { type TenantTransactionClient } from "../db/prisma.js";
import { activeRotationAssignees, rotationAssigneeAt } from "./assignmentRules.js";
import { parisWallTime } from "./cleaningTasks.js";
import { getOrganizationId } from "./organizationContext.js";
import { toParisIsoDate } from "./userInterventions.js";

export type ActionTaskCategory = "short" | "long";
export type ActionTaskCompensationMode = "none" | "flat_rate" | "time";

export const ACTION_TASK_SHORTCUTS = [
  { key: "hand-soap", title: "Apporter du savon à main", category: "short" as const },
  { key: "toilet-paper", title: "Apporter du papier toilette", category: "short" as const },
  { key: "vacuum-bags", title: "Apporter des sacs d’aspirateur", category: "short" as const },
  { key: "light-bulb", title: "Remplacer une ampoule", category: "short" as const },
  { key: "maintenance-check", title: "Prévoir une vérification technique", category: "long" as const },
] as const;

const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (day: string, count: number) =>
  isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000));

export const actionWindow = (eventDay: string, template: {
  starts_offset_days: number; due_offset_days: number; start_time: string; due_time: string;
}) => ({
  startsAt: parisWallTime(addDays(eventDay, template.starts_offset_days), template.start_time),
  dueAt: parisWallTime(addDays(eventDay, template.due_offset_days), template.due_time),
});

export const syncActionTasks = async (from: string, to: string) => {
  const templates = await prisma.actionTemplate.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  if (!templates.length) return;
  const start = addDays(from, -30);
  const end = addDays(to, 30);
  const rangeStart = parisWallTime(from, "00:00");
  const rangeEnd = parisWallTime(addDays(to, 1), "00:00");
  const reservations = await prisma.reservation.findMany({
    where: { OR: [
      { date_entree: { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${addDays(end, 1)}T00:00:00Z`) } },
      { date_sortie: { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${addDays(end, 1)}T00:00:00Z`) } },
    ] },
    select: { id: true, gite_id: true, date_entree: true, date_sortie: true, nb_nuits: true },
    orderBy: [{ date_entree: "asc" }, { id: "asc" }],
  });
  const existing = await prisma.actionTask.findMany({
    where: { template_id: { in: templates.map((item) => item.id) }, reservation_id: { in: reservations.map((item) => item.id) } },
  });
  const existingByKey = new Map(existing.map((item) => [`${item.template_id}:${item.reservation_id}`, item]));
  for (const template of templates) {
    const candidates = reservations.filter((reservation) => reservation.gite_id === template.gite_id)
      .sort((left, right) => {
        const a = template.trigger_event === "arrival" ? left.date_entree : left.date_sortie;
        const b = template.trigger_event === "arrival" ? right.date_entree : right.date_sortie;
        return a.getTime() - b.getTime() || left.id.localeCompare(right.id);
      });
    const eligibleReservationIds: string[] = [];
    for (const reservation of candidates) {
      const eventDay = isoDay(template.trigger_event === "arrival" ? reservation.date_entree : reservation.date_sortie);
      const { startsAt, dueAt } = actionWindow(eventDay, template);
      const interventionDay = toParisIsoDate(startsAt);
      if ((template.active_from && interventionDay < template.active_from) || (template.active_to && interventionDay > template.active_to)
        || (template.minimum_nights && reservation.nb_nuits < template.minimum_nights)) continue;
      eligibleReservationIds.push(reservation.id);
      if (startsAt >= rangeEnd || dueAt < rangeStart) continue;
      const oldTask = existingByKey.get(`${template.id}:${reservation.id}`);
      if (oldTask) {
        if (oldTask.status === "planned" && oldTask.source_type !== "customized" && (oldTask.starts_at.getTime() !== startsAt.getTime()
          || oldTask.due_at.getTime() !== dueAt.getTime() || oldTask.title !== template.title
          || oldTask.category !== template.category || oldTask.compensation_mode !== template.compensation_mode
          || Number(oldTask.compensation_amount) !== Number(template.compensation_amount)
          || (template.assignment_mode === "fixed" && oldTask.assignee_id !== template.default_assignee_id) || oldTask.note !== template.note)) {
          await prisma.actionTask.update({ where: { id: oldTask.id }, data: {
            starts_at: startsAt, due_at: dueAt, title: template.title,
            category: template.category, compensation_mode: template.compensation_mode,
            compensation_amount: template.compensation_amount,
            ...(template.assignment_mode === "fixed" ? { assignee_id: template.default_assignee_id } : {}), note: template.note,
            spent_minutes: template.compensation_mode === "time" ? template.default_minutes : null,
          } });
        }
        continue;
      }
      let created;
      try {
        created = await prisma.actionTask.create({ data: {
          template_id: template.id, reservation_id: reservation.id, gite_id: template.gite_id,
          title: template.title, starts_at: startsAt, due_at: dueAt,
          assignee_id: template.assignment_mode === "fixed" ? template.default_assignee_id : null,
          category: template.category, compensation_mode: template.compensation_mode,
          compensation_amount: template.compensation_amount,
          spent_minutes: template.compensation_mode === "time" ? template.default_minutes : null,
          source_type: "automatic", note: template.note,
        } });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") continue;
        throw error;
      }
      if (template.assignment_mode === "rotation") {
        const pool = await activeRotationAssignees(template.rotation_assignee_ids);
        if (pool.length) {
          const rotated = await prisma.actionTemplate.update({
            where: { id: template.id }, data: { rotation_cursor: { increment: 1 } }, select: { rotation_cursor: true },
          });
          await prisma.actionTask.update({ where: { id: created.id }, data: { assignee_id: rotationAssigneeAt(pool, rotated.rotation_cursor) } });
        }
      }
    }
    if (template.planning_period_id) await prisma.actionTask.deleteMany({ where: {
      template_id: template.id, status: "planned", source_type: "automatic",
      starts_at: { gte: new Date(Math.max(Date.now(), rangeStart.getTime())), lt: rangeEnd }, reservation_id: { notIn: eligibleReservationIds },
    } });
  }
};

export const serializeActionTask = (task: {
  id: string; template_id: string | null; reservation_id: string | null; gite_id: string;
  title: string; assignee_id: string | null; status: string; starts_at: Date; due_at: Date;
  completed_at: Date | null; note: string; category: string; compensation_mode: string;
  compensation_amount: unknown; spent_minutes: number | null; source_type: string;
  updatedAt: Date;
  urgency_level?: number; urgency_starts_at?: Date | null; urgency_stopped_at?: Date | null;
  urgency_first_sent_at?: Date | null;
  created_by_id?: string | null;
}, names: { gite?: string; assignee?: string | null; creator?: string | null }) => ({
  id: task.id, template_id: task.template_id, reservation_id: task.reservation_id,
  gite_id: task.gite_id, gite_name: names.gite ?? "Gîte", title: task.title,
  assignee_id: task.assignee_id, assignee_name: names.assignee ?? null,
  status: task.status, starts_at: task.starts_at.toISOString(), due_at: task.due_at.toISOString(),
  completed_at: task.completed_at?.toISOString() ?? null, note: task.note,
  category: task.category, compensation_mode: task.compensation_mode,
  compensation_amount: Number(task.compensation_amount ?? 0), spent_minutes: task.spent_minutes,
  source_type: task.source_type,
  updated_at: task.updatedAt.toISOString(),
  created_by_id: task.created_by_id ?? null,
  created_by_name: names.creator ?? null,
  urgency_level: task.urgency_level ?? 0,
  urgency_starts_at: task.urgency_starts_at?.toISOString() ?? null,
  urgency_stopped_at: task.urgency_stopped_at?.toISOString() ?? null,
  urgency_first_sent_at: task.urgency_first_sent_at?.toISOString() ?? null,
});

export const summarizeActionTasks = (tasks: Array<{ category: string; status: string }>) => ({
  open_short: tasks.filter((task) => task.status !== "done" && task.category === "short").length,
  open_long: tasks.filter((task) => task.status !== "done" && task.category === "long").length,
  completed: tasks.filter((task) => task.status === "done").length,
});

type CompensatedActionTask = {
  id: string;
  title: string;
  gite_id: string;
  reservation_id: string | null;
  assignee_id: string | null;
  compensation_mode: string;
  compensation_amount: unknown;
  spent_minutes: number | null;
};

export const recordActionTaskCompensation = async (
  task: CompensatedActionTask,
  completedAt: Date,
  requestedMinutes?: number | null,
  database: TenantTransactionClient = prisma,
) => {
  if (task.compensation_mode === "none") return { spentMinutes: task.spent_minutes };
  if (!task.assignee_id) {
    throw Object.assign(new Error("Attribuez la tâche à l’intervenant qui l’a réalisée."), { status: 409 });
  }
  const [user, gite] = await Promise.all([
    database.appUser.findUnique({ where: { id: task.assignee_id }, select: { id: true, display_name: true, intervenant_id: true } }),
    database.gite.findUnique({ where: { id: task.gite_id }, select: { id: true, nom: true } }),
  ]);
  if (!user?.intervenant_id || !gite) {
    throw Object.assign(new Error("L’intervenant de cette tâche est inactif ou introuvable."), { status: 409 });
  }
  if (task.compensation_mode === "flat_rate") {
    await database.userIntervention.upsert({
      where: { organization_id_source_key: { organization_id: getOrganizationId(), source_key: `action-task:${task.id}` } },
      update: {},
      create: {
        user_id: user.id, user_name: user.display_name, kind: "task",
        occurred_on: toParisIsoDate(completedAt), gite_id: gite.id, gite_name: gite.nom,
        reservation_id: task.reservation_id,
        source_key: `action-task:${task.id}`, amount_snapshot: Number(task.compensation_amount ?? 0), automatic: true,
      },
    });
    return { spentMinutes: null };
  }
  const spentMinutes = requestedMinutes ?? task.spent_minutes;
  if (!spentMinutes || !Number.isInteger(spentMinutes) || spentMinutes < 1 || spentMinutes > 1440) {
    throw Object.assign(new Error("Indiquez le temps réellement passé sur cette tâche."), { status: 409 });
  }
  const id = `action-task:${task.id}`;
  const existing = await database.intervenantHourEntry.findUnique({ where: { id } });
  if (existing?.paid_at && (existing.intervenant_id !== user.intervenant_id || existing.minutes !== spentMinutes)) {
    throw Object.assign(new Error("Le temps de cette tâche a déjà été payé et ne peut plus être modifié ici."), { status: 409 });
  }
  await database.intervenantHourEntry.upsert({
    where: { id },
    update: existing?.paid_at ? {} : {
      intervenant_id: user.intervenant_id, intervenant_nom: user.display_name,
      worked_on: toParisIsoDate(completedAt), minutes: spentMinutes, deleted_at: null,
    },
    create: {
      id, intervenant_id: user.intervenant_id, intervenant_nom: user.display_name,
      worked_on: toParisIsoDate(completedAt), minutes: spentMinutes,
    },
  });
  return { spentMinutes };
};

export const removeActionTaskCompensation = async (taskId: string) => {
  const sourceKey = `action-task:${taskId}`;
  const [intervention, hours] = await Promise.all([
    prisma.userIntervention.findUnique({ where: { organization_id_source_key: { organization_id: getOrganizationId(), source_key: sourceKey } } }),
    prisma.intervenantHourEntry.findUnique({ where: { id: sourceKey } }),
  ]);
  if (intervention?.paid_at || hours?.paid_at) {
    throw Object.assign(new Error("Cette tâche a déjà été payée et ne peut plus être rouverte ici."), { status: 409 });
  }
  await Promise.all([
    prisma.userIntervention.deleteMany({ where: { source_key: sourceKey, paid_at: null } }),
    prisma.intervenantHourEntry.deleteMany({ where: { id: sourceKey, paid_at: null } }),
  ]);
};
