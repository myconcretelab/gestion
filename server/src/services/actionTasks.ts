import prisma from "../db/prisma.js";
import { activeRotationAssignees, rotationAssigneeAt } from "./assignmentRules.js";
import { parisWallTime } from "./cleaningTasks.js";

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
    select: { id: true, gite_id: true, date_entree: true, date_sortie: true },
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
    for (const reservation of candidates) {
      const eventDay = isoDay(template.trigger_event === "arrival" ? reservation.date_entree : reservation.date_sortie);
      const { startsAt, dueAt } = actionWindow(eventDay, template);
      if (startsAt >= rangeEnd || dueAt < rangeStart) continue;
      const oldTask = existingByKey.get(`${template.id}:${reservation.id}`);
      if (oldTask) {
        if (oldTask.status !== "done" && (oldTask.starts_at.getTime() !== startsAt.getTime()
          || oldTask.due_at.getTime() !== dueAt.getTime() || oldTask.title !== template.title)) {
          await prisma.actionTask.update({ where: { id: oldTask.id }, data: { starts_at: startsAt, due_at: dueAt, title: template.title } });
        }
        continue;
      }
      let created;
      try {
        created = await prisma.actionTask.create({ data: {
          template_id: template.id, reservation_id: reservation.id, gite_id: template.gite_id,
          title: template.title, starts_at: startsAt, due_at: dueAt,
          assignee_id: template.assignment_mode === "fixed" ? template.default_assignee_id : null,
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
  }
};

export const serializeActionTask = (task: {
  id: string; template_id: string | null; reservation_id: string | null; gite_id: string;
  title: string; assignee_id: string | null; status: string; starts_at: Date; due_at: Date;
  completed_at: Date | null; note: string;
}, names: { gite?: string; assignee?: string | null }) => ({
  id: task.id, template_id: task.template_id, reservation_id: task.reservation_id,
  gite_id: task.gite_id, gite_name: names.gite ?? "Gîte", title: task.title,
  assignee_id: task.assignee_id, assignee_name: names.assignee ?? null,
  status: task.status, starts_at: task.starts_at.toISOString(), due_at: task.due_at.toISOString(),
  completed_at: task.completed_at?.toISOString() ?? null, note: task.note,
});
