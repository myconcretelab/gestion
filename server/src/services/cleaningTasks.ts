import prisma from "../db/prisma.js";
import type { AppUserSummary } from "./appUsers.js";
import { getOrganizationId } from "./organizationContext.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { activeRotationAssignees, rotationAssigneeAt } from "./assignmentRules.js";

export type CleaningGenerationMode = "always" | "option_only" | "disabled";
export type CleaningScheduleMode = "after_departure" | "day_before_arrival" | "arrival_day";

export const DEFAULT_CLEANING_RULE = {
  generation_mode: "always" as CleaningGenerationMode,
  schedule_mode: "after_departure" as CleaningScheduleMode,
  default_assignee_id: null as string | null,
  assignment_mode: "unassigned" as const,
  rotation_assignee_ids: "[]",
  requires_check: true,
  notify_on_complete: false,
  reminder_minutes: 60,
  buffer_minutes: 0,
};

export const canManageCleaning = (user: AppUserSummary | null) =>
  !user || user.permissions.isOwner || (user.status !== "worker" && user.permissions.canWrite);

const dateIso = (value: Date) => value.toISOString().slice(0, 10);
const addIsoDays = (value: string, days: number) =>
  dateIso(new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000));

/** Convert a local time in the organization's current Paris calendar to an instant. */
export const parisWallTime = (day: string, time: string) => {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instant += wall - observed;
  }
  return new Date(instant);
};

export const cleaningWindow = (params: {
  departureDate: string;
  departureTime: string;
  arrivalDate: string | null;
  arrivalTime: string;
  scheduleMode: CleaningScheduleMode;
  bufferMinutes: number;
}) => {
  const departureAt = parisWallTime(params.departureDate, params.departureTime);
  const arrivalAt = params.arrivalDate ? parisWallTime(params.arrivalDate, params.arrivalTime) : null;
  const preferred = params.arrivalDate && params.scheduleMode === "day_before_arrival"
    ? parisWallTime(addIsoDays(params.arrivalDate, -1), "08:00")
    : params.arrivalDate && params.scheduleMode === "arrival_day"
      ? parisWallTime(params.arrivalDate, "00:00")
      : departureAt;
  const startsAt = new Date(Math.max(departureAt.getTime(), preferred.getTime()));
  const dueAt = arrivalAt ? new Date(arrivalAt.getTime() - params.bufferMinutes * 60_000) : null;
  return { startsAt, dueAt, impossibleWindow: Boolean(dueAt && startsAt >= dueAt) };
};

export const syncCleaningTasks = async (from: string, to: string) => {
  const [gites, reservations, rules] = await Promise.all([
    prisma.gite.findMany({ select: { id: true, nom: true, heure_depart_defaut: true, heure_arrivee_defaut: true } }),
    prisma.reservation.findMany({
      where: { OR: [
        { date_sortie: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addIsoDays(to, 1)}T00:00:00Z`) } },
        { date_entree: { gte: new Date(`${from}T00:00:00Z`) } },
      ] },
      select: { id: true, gite_id: true, date_entree: true, date_sortie: true, options: true,
        departure_cleaning_checked_at: true, departure_cleaning_checked_by_user_id: true },
      orderBy: { date_entree: "asc" },
    }),
    prisma.cleaningRule.findMany(),
  ]);
  const priorDepartures = await Promise.all(gites.map((gite) => prisma.reservation.findFirst({
    where: { gite_id: gite.id, date_sortie: { lt: new Date(`${from}T00:00:00Z`) } },
    select: { id: true, gite_id: true, date_entree: true, date_sortie: true, options: true,
      departure_cleaning_checked_at: true, departure_cleaning_checked_by_user_id: true },
    orderBy: { date_sortie: "desc" },
  })));
  const allReservations = [...reservations, ...priorDepartures.filter((item): item is NonNullable<typeof item> => item !== null)];
  const giteById = new Map(gites.map((item) => [item.id, item]));
  const ruleByGite = new Map(rules.map((item) => [item.gite_id, item]));
  const departures = allReservations.filter((item) => {
    if (!item.gite_id || !giteById.has(item.gite_id)) return false;
    const day = dateIso(item.date_sortie);
    if (day >= from && day <= to) return true;
    return day < from && reservations.some((candidate) =>
      candidate.gite_id === item.gite_id && candidate.id !== item.id
      && candidate.date_entree >= item.date_sortie
      && dateIso(candidate.date_entree) >= from && dateIso(candidate.date_entree) <= to
    );
  }).sort((left, right) => left.date_sortie.getTime() - right.date_sortie.getTime() || left.id.localeCompare(right.id));
  if (!departures.length) return;

  const existing = await prisma.cleaningTask.findMany({ where: { departure_reservation_id: { in: departures.map((item) => item.id) } } });
  const existingByDeparture = new Map(existing.map((item) => [item.departure_reservation_id, item]));
  const assignments = await prisma.planningRelayAssignment.findMany({
    where: { date: { gte: from, lte: to } }, orderBy: { updatedAt: "desc" },
  });
  const workerIds = [...new Set(assignments.map((item) => item.worker_id))];
  const users = workerIds.length ? await prisma.appUser.findMany({ where: { intervenant_id: { in: workerIds } }, select: { id: true, intervenant_id: true } }) : [];
  const userByWorker = new Map(users.map((item) => [item.intervenant_id, item.id]));
  const inheritedAssignee = new Map<string, string>();
  for (const assignment of assignments) {
    const key = `${assignment.date}:${assignment.gite_id}`;
    const userId = userByWorker.get(assignment.worker_id);
    if (userId && !inheritedAssignee.has(key)) inheritedAssignee.set(key, userId);
  }

  for (const departure of departures) {
    const giteId = departure.gite_id as string;
    const gite = giteById.get(giteId)!;
    const rule = ruleByGite.get(giteId) ?? DEFAULT_CLEANING_RULE;
    const oldTask = existingByDeparture.get(departure.id);
    const opted = Boolean(fromJsonString<{ menage?: { enabled?: boolean } }>(departure.options, {}).menage?.enabled);
    if (!oldTask && (rule.generation_mode === "disabled" || (rule.generation_mode === "option_only" && !opted))) continue;
    const nextArrival = allReservations
      .filter((item) => item.gite_id === giteId && item.id !== departure.id && item.date_entree >= departure.date_sortie)
      .sort((left, right) => left.date_entree.getTime() - right.date_entree.getTime())[0] ?? null;
    const window = cleaningWindow({
      departureDate: dateIso(departure.date_sortie), departureTime: gite.heure_depart_defaut || "10:00",
      arrivalDate: nextArrival ? dateIso(nextArrival.date_entree) : null,
      arrivalTime: gite.heure_arrivee_defaut || "17:00",
      scheduleMode: rule.schedule_mode as CleaningScheduleMode,
      bufferMinutes: rule.buffer_minutes,
    });
    if (oldTask) {
      if ((oldTask.status === "planned" || oldTask.status === "in_progress") && (
        oldTask.arrival_reservation_id !== (nextArrival?.id ?? null)
        || oldTask.starts_at.getTime() !== window.startsAt.getTime()
        || oldTask.due_at?.getTime() !== (window.dueAt?.getTime() ?? undefined)
      )) {
        await prisma.cleaningTask.update({ where: { id: oldTask.id }, data: {
          arrival_reservation_id: nextArrival?.id ?? null, starts_at: window.startsAt, due_at: window.dueAt,
        } });
      }
      continue;
    }
    const checkedAt = departure.departure_cleaning_checked_at;
    const inherited = inheritedAssignee.get(`${dateIso(departure.date_sortie)}:${giteId}`);
    let created;
    try {
      created = await prisma.cleaningTask.create({ data: {
        gite_id: giteId, departure_reservation_id: departure.id, arrival_reservation_id: nextArrival?.id ?? null,
        assignee_id: inherited ?? (rule.assignment_mode === "fixed" ? rule.default_assignee_id : null),
        starts_at: window.startsAt, due_at: window.dueAt,
        status: checkedAt ? "verified" : "planned",
        completed_at: checkedAt, completed_by_id: departure.departure_cleaning_checked_by_user_id,
        checked_at: checkedAt, checked_by_id: departure.departure_cleaning_checked_by_user_id,
      } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") continue;
      throw error;
    }
    if (!inherited && rule.assignment_mode === "rotation" && "id" in rule) {
      const pool = await activeRotationAssignees(rule.rotation_assignee_ids);
      if (pool.length) {
        const rotated = await prisma.cleaningRule.update({
          where: { organization_id_gite_id: { organization_id: getOrganizationId(), gite_id: giteId } },
          data: { rotation_cursor: { increment: 1 } }, select: { rotation_cursor: true },
        });
        await prisma.cleaningTask.update({ where: { id: created.id }, data: { assignee_id: rotationAssigneeAt(pool, rotated.rotation_cursor) } });
      }
    }
  }
};

export const serializeCleaningTask = (task: {
  id: string; gite_id: string; departure_reservation_id: string; arrival_reservation_id: string | null;
  assignee_id: string | null; status: string; starts_at: Date; due_at: Date | null;
  completed_at: Date | null; checked_at: Date | null; note: string;
}, names: { gite?: string; assignee?: string | null }, requiresCheck: boolean) => ({
  id: task.id, gite_id: task.gite_id, gite_name: names.gite ?? "Gîte",
  departure_reservation_id: task.departure_reservation_id,
  arrival_reservation_id: task.arrival_reservation_id,
  assignee_id: task.assignee_id, assignee_name: names.assignee ?? null,
  status: task.status, starts_at: task.starts_at.toISOString(), due_at: task.due_at?.toISOString() ?? null,
  completed_at: task.completed_at?.toISOString() ?? null, checked_at: task.checked_at?.toISOString() ?? null,
  requires_check: requiresCheck, schedule_conflict: Boolean(task.due_at && task.starts_at >= task.due_at), note: task.note,
});

export const listCleaningTasksForDepartures = (departureIds: string[]) =>
  prisma.cleaningTask.findMany({ where: { departure_reservation_id: { in: departureIds } } });

export const getCleaningTaskForDeparture = (departureId: string) =>
  prisma.cleaningTask.findFirst({ where: { departure_reservation_id: departureId } });

export const doesCleaningRequireCheck = async (giteId: string) => {
  const rule = await prisma.cleaningRule.findFirst({ where: { gite_id: giteId }, select: { requires_check: true } });
  return rule?.requires_check ?? true;
};

export const setCleaningTaskReadiness = async (
  departureId: string, departureDate: string, checked: boolean, checkedAt: Date | null, userId: string | null,
) => {
  await syncCleaningTasks(departureDate, departureDate);
  const task = await getCleaningTaskForDeparture(departureId);
  if (!task) return null;
  await prisma.cleaningTask.update({ where: { id: task.id }, data: checked ? {
    status: "verified", completed_at: task.completed_at ?? checkedAt,
    completed_by_id: task.completed_by_id ?? userId,
    checked_at: checkedAt, checked_by_id: userId,
  } : {
    status: task.completed_at ? "done" : "planned", checked_at: null, checked_by_id: null,
  } });
  return task;
};

export const applyLegacyCleaningAssignment = async (giteId: string, day: string, workerId: string | null) => {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const [nextUser, departures] = await Promise.all([
    workerId ? prisma.appUser.findFirst({ where: { intervenant_id: workerId }, select: { id: true } }) : null,
    prisma.reservation.findMany({ where: { gite_id: giteId, date_sortie: { gte: start, lt: end } }, select: { id: true } }),
  ]);
  if (departures.length) await prisma.cleaningTask.updateMany({
    where: { departure_reservation_id: { in: departures.map((row) => row.id) } },
    data: { assignee_id: nextUser?.id ?? null },
  });
};

export const markCleaningTaskCheckedFromPublicLink = (departureId: string, checkedAt: Date) =>
  prisma.cleaningTask.updateMany({
    where: { departure_reservation_id: departureId },
    data: { status: "verified", completed_at: checkedAt, checked_at: checkedAt, checked_by_id: null },
  });
