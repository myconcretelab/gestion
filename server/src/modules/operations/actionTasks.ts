import { Router } from "express";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
import { canManageCleaning, parisWallTime } from "../../services/cleaningTasks.js";
import { parseRotationAssignees, validateAssignees } from "../../services/assignmentRules.js";
import { serializeActionTask, syncActionTasks } from "../../services/actionTasks.js";

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const assignment = {
  assignment_mode: z.enum(["unassigned", "fixed", "rotation"]),
  default_assignee_id: z.string().nullable(),
  rotation_assignee_ids: z.array(z.string()).max(50),
};
const templateSchema = z.object({
  gite_id: z.string(), title: z.string().trim().min(2).max(120),
  trigger_event: z.enum(["arrival", "departure"]),
  starts_offset_days: z.number().int().min(-30).max(30),
  due_offset_days: z.number().int().min(-30).max(30),
  start_time: clockTime, due_time: clockTime, enabled: z.boolean(), ...assignment,
});
const manualSchema = z.object({
  gite_id: z.string(), title: z.string().trim().min(2).max(120),
  start_day: isoDate, start_time: clockTime, due_day: isoDate, due_time: clockTime,
  assignee_id: z.string().nullable(), note: z.string().trim().max(2000).default(""),
});
const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

const checkAssignee = async (id: string | null) => !id || await validateAssignees([id]);
const checkTemplate = async (payload: z.infer<typeof templateSchema>) => {
  if (payload.due_offset_days * 1440 + minutes(payload.due_time)
    <= payload.starts_offset_days * 1440 + minutes(payload.start_time)) return "L’échéance doit suivre le début de l’action.";
  if (!await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } })) return "Gîte introuvable.";
  if (payload.assignment_mode === "fixed" && (!payload.default_assignee_id || !await checkAssignee(payload.default_assignee_id))) return "Choisissez un intervenant actif.";
  if (payload.assignment_mode === "rotation" && (!payload.rotation_assignee_ids.length || !await validateAssignees(payload.rotation_assignee_ids))) return "Choisissez des intervenants actifs pour la rotation.";
  return null;
};
const serializeTemplate = (template: {
  id: string; gite_id: string; title: string; trigger_event: string; starts_offset_days: number;
  due_offset_days: number; start_time: string; due_time: string; assignment_mode: string;
  default_assignee_id: string | null; rotation_assignee_ids: string; enabled: boolean;
}) => ({ ...template, rotation_assignee_ids: parseRotationAssignees(template.rotation_assignee_ids) });

const taskResponse = async (id: string) => {
  const task = await prisma.actionTask.findUnique({ where: { id } });
  if (!task) return null;
  const [gite, assignee] = await Promise.all([
    prisma.gite.findUnique({ where: { id: task.gite_id }, select: { nom: true } }),
    task.assignee_id ? prisma.appUser.findUnique({ where: { id: task.assignee_id }, select: { display_name: true } }) : null,
  ]);
  return serializeActionTask(task, { gite: gite?.nom, assignee: assignee?.display_name });
};

router.get("/", async (req, res, next) => {
  try {
    const today = new Date();
    const query = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const from = query.from ?? formatDate(shiftDate(today, -14));
    const to = query.to ?? formatDate(shiftDate(today, 60));
    if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) {
      return res.status(400).json({ error: "La période doit couvrir au plus un an." });
    }
    await syncActionTasks(from, to);
    const user = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(user);
    const [tasks, templates, gites, users] = await Promise.all([
      prisma.actionTask.findMany({ where: {
        ...(manager ? {} : { assignee_id: user?.id ?? "" }),
        starts_at: { lt: parisWallTime(formatDate(shiftDate(new Date(`${to}T00:00:00Z`), 1)), "00:00") },
        due_at: { gte: parisWallTime(from, "00:00") },
      }, orderBy: [{ starts_at: "asc" }, { createdAt: "asc" }] }),
      manager ? prisma.actionTemplate.findMany({ orderBy: [{ gite_id: "asc" }, { title: "asc" }] }) : [],
      prisma.gite.findMany({ select: { id: true, nom: true } }),
      prisma.appUser.findMany({ where: { is_active: true }, select: { id: true, display_name: true, intervenant_id: true } }),
    ]);
    const giteById = new Map(gites.map((item) => [item.id, item.nom]));
    const userById = new Map(users.map((item) => [item.id, item.display_name]));
    return res.json({
      tasks: tasks.map((task) => serializeActionTask(task, { gite: giteById.get(task.gite_id), assignee: userById.get(task.assignee_id ?? "") })),
      templates: manager ? templates.map(serializeTemplate) : [],
      gites: manager ? gites : [],
      assignees: manager ? users.filter((item) => item.intervenant_id).map((item) => ({ id: item.id, name: item.display_name })) : [],
      can_manage: manager,
    });
  } catch (error) { next(error); }
});

router.post("/templates", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const payload = templateSchema.parse(req.body);
    const error = await checkTemplate(payload);
    if (error) return res.status(400).json({ error });
    const created = await prisma.actionTemplate.create({ data: { ...payload, rotation_assignee_ids: JSON.stringify([...new Set(payload.rotation_assignee_ids)]) } });
    return res.status(201).json(serializeTemplate(created));
  } catch (error) { next(error); }
});

router.put("/templates/:id", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const payload = templateSchema.parse(req.body);
    const previous = await prisma.actionTemplate.findUnique({
      where: { id: req.params.id }, select: { id: true, assignment_mode: true, rotation_assignee_ids: true },
    });
    if (!previous) return res.status(404).json({ error: "Modèle introuvable." });
    const error = await checkTemplate(payload);
    if (error) return res.status(400).json({ error });
    const rotationAssignees = JSON.stringify([...new Set(payload.rotation_assignee_ids)]);
    const resetRotation = previous.assignment_mode !== payload.assignment_mode || previous.rotation_assignee_ids !== rotationAssignees;
    const updated = await prisma.actionTemplate.update({ where: { id: req.params.id }, data: {
      ...payload, rotation_assignee_ids: rotationAssignees, ...(resetRotation ? { rotation_cursor: 0 } : {}),
    } });
    return res.json(serializeTemplate(updated));
  } catch (error) { next(error); }
});

router.post("/tasks", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const payload = manualSchema.parse(req.body);
    if (!await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } })) return res.status(404).json({ error: "Gîte introuvable." });
    if (!await checkAssignee(payload.assignee_id)) return res.status(400).json({ error: "Intervenant invalide." });
    const startsAt = parisWallTime(payload.start_day, payload.start_time);
    const dueAt = parisWallTime(payload.due_day, payload.due_time);
    if (startsAt >= dueAt) return res.status(400).json({ error: "L’échéance doit suivre le début de l’action." });
    const task = await prisma.actionTask.create({ data: {
      gite_id: payload.gite_id, title: payload.title, starts_at: startsAt, due_at: dueAt,
      assignee_id: payload.assignee_id, note: payload.note,
    } });
    return res.status(201).json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id/assignment", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Attribution réservée aux gestionnaires." });
    const { assignee_id } = z.object({ assignee_id: z.string().nullable() }).parse(req.body);
    if (!await checkAssignee(assignee_id)) return res.status(400).json({ error: "Intervenant invalide." });
    if (!await prisma.actionTask.findUnique({ where: { id: req.params.id }, select: { id: true } })) return res.status(404).json({ error: "Action introuvable." });
    await prisma.actionTask.update({ where: { id: req.params.id }, data: { assignee_id } });
    return res.json(await taskResponse(req.params.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id/note", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Action introuvable." });
    if (!canManageCleaning(user) && task.assignee_id !== user?.id) return res.status(403).json({ error: "Cette action ne vous est pas attribuée." });
    const { note } = z.object({ note: z.string().trim().max(2000) }).parse(req.body);
    await prisma.actionTask.update({ where: { id: task.id }, data: { note } });
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id/status", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(user);
    const { status } = z.object({ status: z.enum(["planned", "in_progress", "done"]) }).parse(req.body);
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Action introuvable." });
    if (!manager && task.assignee_id !== user?.id) return res.status(403).json({ error: "Cette action ne vous est pas attribuée." });
    if (!manager && (status === "planned" || task.status === "done")) return res.status(403).json({ error: "Action réservée au gestionnaire." });
    if (!manager && new Date() < task.starts_at) return res.status(409).json({ error: "Cette action n’est pas encore disponible." });
    await prisma.actionTask.update({ where: { id: task.id }, data: {
      status, completed_at: status === "done" ? task.completed_at ?? new Date() : null,
      completed_by_id: status === "done" ? task.completed_by_id ?? user?.id ?? null : null,
    } });
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

export default router;
