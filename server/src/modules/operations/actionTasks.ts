import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
import { canManageCleaning, parisWallTime } from "../../services/cleaningTasks.js";
import { getParisClock } from "../../services/giteCleaningReadiness.js";
import { parseRotationAssignees, validateAssignees } from "../../services/assignmentRules.js";
import {
  recordActionTaskCompensation,
  removeActionTaskCompensation,
  serializeActionTask,
  summarizeActionTasks,
  syncActionTasks,
} from "../../services/actionTasks.js";
import { readTaskShortcuts, resolveTaskShortcut, saveTaskShortcuts, taskShortcutCatalogSchema } from "../../services/taskShortcuts.js";
import { readTaskReminderSettings, saveTaskReminderSettings, taskReminderSettingsSchema } from "../../services/taskReminderSettings.js";
import { taskUrgencyData, validateTaskUrgency } from "../../services/taskUrgency.js";
import { readTelegramNotificationConfig } from "../../services/telegramNotifications.js";
import { env } from "../../config/env.js";

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const assignment = {
  assignment_mode: z.enum(["unassigned", "fixed", "rotation"]),
  default_assignee_id: z.string().nullable(),
  rotation_assignee_ids: z.array(z.string()).max(50),
};
const taskCategory = z.enum(["short", "long"]);
const compensationMode = z.enum(["none", "flat_rate", "time"]);
const templateSchema = z.object({
  gite_id: z.string(), title: z.string().trim().min(2).max(120),
  category: taskCategory.default("short"),
  compensation_mode: compensationMode.default("none"),
  compensation_amount: z.number().min(0).max(100000).default(0),
  default_minutes: z.number().int().min(1).max(1440).nullable().default(null),
  trigger_event: z.enum(["arrival", "departure"]),
  starts_offset_days: z.number().int().min(-30).max(30),
  due_offset_days: z.number().int().min(-30).max(30),
  start_time: clockTime, due_time: clockTime, enabled: z.boolean(), ...assignment,
});
const manualSchema = z.object({
  urgency_level: z.number().int().min(0).max(2).default(0),
  gite_id: z.string(), title: z.string().trim().min(2).max(120),
  start_day: isoDate, start_time: clockTime, due_day: isoDate, due_time: clockTime,
  assignee_id: z.string().nullable(), note: z.string().trim().max(2000).default(""),
  reservation_id: z.string().nullable().optional(),
  category: taskCategory.default("short"),
  compensation_mode: compensationMode.default("none"),
  compensation_amount: z.number().min(0).max(100000).default(0),
  spent_minutes: z.number().int().min(1).max(1440).nullable().default(null),
  source_type: z.enum(["manual", "shortcut", "check", "cleaning"]).default("manual"),
});
const quickTaskSchema = z.object({
  urgency_level: z.number().int().min(0).max(2).default(0),
  gite_id: z.string().trim().min(1),
  reservation_id: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(120),
  category: taskCategory.default("short"),
  shortcut_key: z.string().trim().max(60).nullable().optional(),
  source_type: z.enum(["manual", "shortcut", "check", "cleaning", "reservation"]).optional(),
  note: z.string().trim().max(2000).default(""),
});
const taskEditSchema = z.object({
  urgency_level: z.number().int().min(0).max(2).optional(),
  title: z.string().trim().min(2).max(120),
  category: taskCategory,
  due_day: isoDate,
  due_time: clockTime,
  assignee_id: z.string().nullable(),
  note: z.string().trim().max(2000),
  compensation_mode: compensationMode.optional(),
  compensation_amount: z.number().finite().min(0).max(100000).optional(),
  expected_updated_at: z.string().datetime(),
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
  if (payload.compensation_mode === "flat_rate" && payload.compensation_amount <= 0) return "Indiquez le forfait de cette tâche.";
  if (payload.compensation_mode === "time" && !payload.default_minutes) return "Indiquez une durée prévue.";
  return null;
};
const serializeTemplate = (template: {
  id: string; gite_id: string; title: string; trigger_event: string; starts_offset_days: number;
  due_offset_days: number; start_time: string; due_time: string; assignment_mode: string;
  default_assignee_id: string | null; rotation_assignee_ids: string; enabled: boolean;
  category: string; compensation_mode: string; compensation_amount: unknown; default_minutes: number | null;
}) => ({ ...template, rotation_assignee_ids: parseRotationAssignees(template.rotation_assignee_ids) });

const taskResponse = async (id: string) => {
  const task = await prisma.actionTask.findUnique({ where: { id } });
  if (!task) return null;
  const [gite, assignee, creator] = await Promise.all([
    prisma.gite.findUnique({ where: { id: task.gite_id }, select: { nom: true } }),
    task.assignee_id ? prisma.appUser.findUnique({ where: { id: task.assignee_id }, select: { display_name: true } }) : null,
    task.created_by_id ? prisma.appUser.findUnique({ where: { id: task.created_by_id }, select: { display_name: true } }) : null,
  ]);
  return serializeActionTask(task, { gite: gite?.nom, assignee: assignee?.display_name, creator: creator?.display_name });
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
    const [tasks, templates, gites, users, shortcuts] = await Promise.all([
      prisma.actionTask.findMany({ where: {
        ...(manager ? {} : { assignee_id: user?.id ?? "" }),
        starts_at: { lt: parisWallTime(formatDate(shiftDate(new Date(`${to}T00:00:00Z`), 1)), "00:00") },
        due_at: { gte: parisWallTime(from, "00:00") },
      }, orderBy: [{ starts_at: "asc" }, { createdAt: "asc" }] }),
      manager ? prisma.actionTemplate.findMany({ where: { planning_period_id: null }, orderBy: [{ gite_id: "asc" }, { title: "asc" }] }) : [],
      prisma.gite.findMany({ select: { id: true, nom: true } }),
      prisma.appUser.findMany({ where: { is_active: true }, select: { id: true, display_name: true, intervenant_id: true } }),
      readTaskShortcuts(),
    ]);
    const giteById = new Map(gites.map((item) => [item.id, item.nom]));
    const userById = new Map(users.map((item) => [item.id, item.display_name]));
    return res.json({
      tasks: tasks.map((task) => serializeActionTask(task, { gite: giteById.get(task.gite_id), assignee: userById.get(task.assignee_id ?? ""), creator: userById.get(task.created_by_id ?? "") })),
      templates: manager ? templates.map(serializeTemplate) : [],
      gites: manager ? gites : [],
      assignees: manager ? users.filter((item) => item.intervenant_id).map((item) => ({ id: item.id, name: item.display_name })) : [],
      shortcuts: shortcuts.filter((item) => item.enabled),
      shortcut_catalog: manager ? shortcuts : [],
      can_manage: manager,
      current_user_id: user?.id ?? null,
      can_edit_compensation: manager && (!user || user.permissions.canViewAmounts),
      reminder_settings: await readTaskReminderSettings(),
    });
  } catch (error) { next(error); }
});

router.get("/gites/:giteId", async (req, res, next) => {
  try {
    const currentUser = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(currentUser);
    const gite = await prisma.gite.findUnique({ where: { id: req.params.giteId }, select: { id: true, nom: true } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });
    const [tasks, users, shortcuts] = await Promise.all([
      prisma.actionTask.findMany({
        where: { gite_id: gite.id },
        orderBy: [{ category: "desc" }, { due_at: "asc" }, { createdAt: "desc" }],
        take: 100,
      }),
      prisma.appUser.findMany({
        where: {
          is_active: true, intervenant_id: { not: null },
          ...(manager ? {} : { id: currentUser?.id ?? "" }),
        },
        select: { id: true, display_name: true }, orderBy: [{ display_name: "asc" }, { id: "asc" }],
      }),
      readTaskShortcuts(),
    ]);
    const userById = new Map(users.map((item) => [item.id, item.display_name]));
    const creators = await prisma.appUser.findMany({ where: { id: { in: [...new Set(tasks.map((task) => task.created_by_id).filter((id): id is string => Boolean(id)))] } }, select: { id: true, display_name: true } });
    const creatorById = new Map(creators.map((item) => [item.id, item.display_name]));
    return res.json({
      gite,
      summary: summarizeActionTasks(tasks),
      shortcuts: shortcuts.filter((item) => item.enabled),
      can_manage: manager,
      current_user_id: currentUser?.id ?? null,
      can_edit_compensation: manager && (!currentUser || currentUser.permissions.canViewAmounts),
      assignees: users.map((item) => ({ id: item.id, name: item.display_name })),
      tasks: tasks.map((task) => serializeActionTask(task, { gite: gite.nom, assignee: userById.get(task.assignee_id ?? ""), creator: creatorById.get(task.created_by_id ?? "") })),
      reminder_settings: await readTaskReminderSettings(),
    });
  } catch (error) { next(error); }
});

router.get("/reminder-settings", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const telegram = readTelegramNotificationConfig();
    const users = await prisma.appUser.findMany({ where: { is_active: true }, select: { id: true, display_name: true, telegram_chat_id: true }, orderBy: { display_name: "asc" } });
    return res.json({ settings: await readTaskReminderSettings(), telegram_ready: telegram.enabled && Boolean(telegram.bot_token), scheduler_enabled: env.TASK_URGENCY_AUTOMATION_ENABLED,
      users: users.map((user) => ({ id: user.id, name: user.display_name, telegram_ready: Boolean(user.telegram_chat_id?.trim()) })) });
  } catch (error) { next(error); }
});

router.put("/reminder-settings", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const settings = taskReminderSettingsSchema.parse(req.body);
    if (settings.fallback_user_id && !await prisma.appUser.findFirst({ where: { id: settings.fallback_user_id, is_active: true, telegram_chat_id: { not: null } }, select: { id: true } })) {
      return res.status(400).json({ error: "Choisissez un destinataire actif avec un identifiant Telegram renseigné." });
    }
    return res.json({ settings: await saveTaskReminderSettings(settings) });
  } catch (error) { next(error); }
});

router.put("/shortcuts", async (req, res, next) => {
  try {
    if (!canManageCleaning(await getAuthenticatedAppUser(req))) return res.status(403).json({ error: "Action réservée aux gestionnaires." });
    const payload = z.object({ shortcuts: taskShortcutCatalogSchema, expected_shortcuts: taskShortcutCatalogSchema }).parse(req.body ?? {});
    return res.json({ shortcuts: await saveTaskShortcuts(payload.shortcuts, payload.expected_shortcuts) });
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
      where: { id: req.params.id }, select: { id: true, assignment_mode: true, rotation_assignee_ids: true, compensation_amount: true },
    });
    if (!previous) return res.status(404).json({ error: "Modèle introuvable." });
    // Amounts can be omitted by managers who are not allowed to view them.
    if (req.body.compensation_amount === undefined) payload.compensation_amount = Number(previous.compensation_amount);
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
    const user = await getAuthenticatedAppUser(req);
    if (user && !user.permissions.canWrite) return res.status(403).json({ error: "Vous ne pouvez pas créer de tâche." });
    const payload = manualSchema.parse(req.body);
    await validateTaskUrgency(payload.urgency_level, payload.category);
    if (!await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } })) return res.status(404).json({ error: "Gîte introuvable." });
    if (!await checkAssignee(payload.assignee_id)) return res.status(400).json({ error: "Intervenant invalide." });
    if (payload.compensation_mode === "flat_rate" && payload.compensation_amount <= 0) return res.status(400).json({ error: "Indiquez le forfait de cette tâche." });
    const startsAt = parisWallTime(payload.start_day, payload.start_time);
    const dueAt = parisWallTime(payload.due_day, payload.due_time);
    if (startsAt >= dueAt) return res.status(400).json({ error: "L’échéance doit suivre le début de l’action." });
    const task = await prisma.actionTask.create({ data: {
      gite_id: payload.gite_id, title: payload.title, starts_at: startsAt, due_at: dueAt,
      assignee_id: payload.assignee_id, note: payload.note, reservation_id: payload.reservation_id ?? null,
      category: payload.category, compensation_mode: payload.compensation_mode,
      compensation_amount: payload.compensation_amount, spent_minutes: payload.spent_minutes,
      source_type: payload.source_type,
      created_by_id: user?.id ?? null,
      ...taskUrgencyData(payload.urgency_level),
    } });
    return res.status(201).json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.post("/tasks/quick", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (user && !user.permissions.canWrite) return res.status(403).json({ error: "Vous ne pouvez pas créer de tâche." });
    const payload = quickTaskSchema.parse(req.body ?? {});
    const gite = await prisma.gite.findUnique({ where: { id: payload.gite_id }, select: { id: true } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });
    if (payload.reservation_id && !await prisma.reservation.findFirst({ where: { id: payload.reservation_id, gite_id: gite.id }, select: { id: true } })) {
      return res.status(409).json({ error: "Cette réservation n’appartient pas au gîte choisi." });
    }
    const shortcut = payload.shortcut_key ? resolveTaskShortcut(await readTaskShortcuts(), payload.shortcut_key) : null;
    if (payload.shortcut_key && !shortcut) return res.status(409).json({ error: "Cette tâche préenregistrée n’est plus disponible. Rechargez la liste." });
    const category = shortcut?.category ?? payload.category;
    await validateTaskUrgency(payload.urgency_level, category);
    const now = new Date();
    const today = getParisClock(now).dateIso;
    const dueDay = formatDate(shiftDate(new Date(`${today}T00:00:00Z`), category === "short" ? 1 : 30));
    const task = await prisma.actionTask.create({ data: {
      gite_id: gite.id, reservation_id: payload.reservation_id ?? null,
      title: shortcut?.title ?? payload.title, category,
      created_by_id: user?.id ?? null,
      starts_at: now, due_at: parisWallTime(dueDay, category === "short" ? "12:00" : "18:00"),
      note: shortcut?.note ?? payload.note, source_type: payload.source_type ?? (payload.shortcut_key ? "shortcut" : "manual"),
      ...taskUrgencyData(payload.urgency_level, now),
    } });
    return res.status(201).json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id/assignment", async (req, res, next) => {
  try {
    const currentUser = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(currentUser);
    const { assignee_id } = z.object({ assignee_id: z.string().nullable() }).parse(req.body);
    if (!manager && assignee_id !== currentUser?.id) return res.status(403).json({ error: "Vous pouvez seulement prendre cette tâche pour vous-même." });
    if (!await checkAssignee(assignee_id)) return res.status(400).json({ error: "Intervenant invalide." });
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!task) return res.status(404).json({ error: "Tâche introuvable." });
    if (task.status === "done") return res.status(409).json({ error: "Rouvrez la tâche avant de modifier son intervenant." });
    await prisma.actionTask.update({ where: { id: req.params.id }, data: { assignee_id, source_type: "customized", urgency_version: crypto.randomUUID() } });
    return res.json(await taskResponse(req.params.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id/urgency", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    const payload = z.object({ urgency_level: z.number().int().min(0).max(2), expected_updated_at: z.string().datetime() }).parse(req.body);
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Tâche introuvable." });
    if (user && !user.permissions.canWrite) return res.status(403).json({ error: "Vous ne pouvez pas modifier les tâches." });
    if (!canManageCleaning(user) && task.assignee_id && task.assignee_id !== user?.id) return res.status(403).json({ error: "Cette tâche est attribuée à un autre intervenant." });
    if (task.status === "done") return res.status(409).json({ error: "Cette tâche est déjà terminée." });
    await validateTaskUrgency(payload.urgency_level, task.category);
    const { count } = await prisma.actionTask.updateMany({
      where: { id: task.id, status: { not: "done" }, updatedAt: new Date(payload.expected_updated_at) },
      data: { ...taskUrgencyData(payload.urgency_level), ...(task.template_id ? { source_type: "customized" } : {}) },
    });
    if (!count) return res.status(409).json({ error: "Cette tâche a changé entre-temps. Actualisez la liste avant de réessayer." });
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/tasks/:id", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(user);
    const payload = taskEditSchema.parse(req.body);
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Tâche introuvable." });
    if (user && !user.permissions.canWrite) return res.status(403).json({ error: "Vous ne pouvez pas modifier les tâches." });
    if (!manager && task.assignee_id && task.assignee_id !== user?.id) return res.status(403).json({ error: "Cette tâche est attribuée à un autre intervenant." });
    if (task.status === "done") return res.status(409).json({ error: "Rouvrez la tâche avant de la modifier. Une tâche payée se corrige depuis l’historique administrateur." });
    const urgency = payload.category === "short" ? payload.urgency_level ?? task.urgency_level ?? 0 : 0;
    if (urgency !== (task.urgency_level ?? 0)) await validateTaskUrgency(urgency, payload.category);
    if (!manager && payload.assignee_id !== task.assignee_id && payload.assignee_id !== user?.id) return res.status(403).json({ error: "Vous pouvez seulement prendre cette tâche pour vous-même." });
    const mode = payload.compensation_mode ?? task.compensation_mode;
    const amount = payload.compensation_amount ?? Number(task.compensation_amount);
    if (!manager && (mode !== task.compensation_mode || amount !== Number(task.compensation_amount))) return res.status(403).json({ error: "La rémunération se règle par un gestionnaire." });
    if (!await checkAssignee(payload.assignee_id)) return res.status(400).json({ error: "Intervenant invalide." });
    if (mode === "flat_rate" && amount <= 0) return res.status(400).json({ error: "Indiquez le forfait de cette tâche." });
    const day = new Date(`${payload.due_day}T12:00:00Z`);
    if (!Number.isFinite(day.getTime()) || formatDate(day) !== payload.due_day) return res.status(400).json({ error: "Choisissez une date d’échéance valide." });
    const dueAt = parisWallTime(payload.due_day, payload.due_time);
    if (!Number.isFinite(dueAt.getTime()) || dueAt <= task.starts_at) return res.status(400).json({ error: "L’échéance doit suivre le début de la tâche." });
    const { count } = await prisma.actionTask.updateMany({
      where: { id: task.id, status: { not: "done" }, updatedAt: new Date(payload.expected_updated_at) },
      data: {
        title: payload.title, category: payload.category, due_at: dueAt,
        assignee_id: payload.assignee_id, note: payload.note,
        compensation_mode: mode, compensation_amount: amount,
        ...(urgency !== (task.urgency_level ?? 0) ? taskUrgencyData(urgency) : payload.assignee_id !== task.assignee_id ? { urgency_version: crypto.randomUUID() } : {}),
        // Keep this occurrence's edits when its automatic template is synchronized again.
        source_type: task.template_id ? "customized" : task.source_type,
      },
    });
    if (!count) return res.status(409).json({ error: "Cette tâche a changé entre-temps. Rechargez-la avant de réessayer." });
    return res.json(await taskResponse(task.id));
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
    const { status, spent_minutes: requestedMinutes } = z.object({
      status: z.enum(["planned", "in_progress", "done"]),
      spent_minutes: z.number().int().min(1).max(1440).nullable().optional(),
    }).parse(req.body);
    const task = await prisma.actionTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Action introuvable." });
    if (!manager && task.assignee_id !== user?.id) return res.status(403).json({ error: "Cette action ne vous est pas attribuée." });
    if (!manager && (status === "planned" || task.status === "done")) return res.status(403).json({ error: "Action réservée au gestionnaire." });
    if (!manager && new Date() < task.starts_at) return res.status(409).json({ error: "Cette action n’est pas encore disponible." });
    const completedAt = task.completed_at ?? new Date();
    let spentMinutes = task.spent_minutes;
    if (status === "done") {
      const result = await recordActionTaskCompensation(task, completedAt, requestedMinutes);
      spentMinutes = result.spentMinutes ?? null;
    } else if (task.status === "done") {
      await removeActionTaskCompensation(task.id);
    }
    await prisma.actionTask.update({ where: { id: task.id }, data: {
      status, completed_at: status === "done" ? completedAt : null,
      completed_by_id: status === "done" ? task.completed_by_id ?? user?.id ?? null : null,
      spent_minutes: status === "done" ? spentMinutes : task.spent_minutes,
      ...(task.status === "done" && status !== "done" ? taskUrgencyData(0) : {}),
    } });
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

export default router;
