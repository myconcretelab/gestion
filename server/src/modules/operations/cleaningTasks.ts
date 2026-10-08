import { Router } from "express";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { getOrganizationId } from "../../services/organizationContext.js";
import { fromJsonString } from "../../utils/jsonFields.js";
import { getAuthenticatedAppUser } from "../../services/serverAuth.js";
import { canManageCleaning, DEFAULT_CLEANING_RULE, parisWallTime, serializeCleaningTask, syncCleaningTasks } from "../../services/cleaningTasks.js";
import { isCleaningCheckAvailable, loadGiteCleaningReadiness, updateGiteCleaningReadiness } from "../../services/giteCleaningReadiness.js";
import { notifyCleaningCompletedOnTelegram, notifyGiteCheckedOnTelegram } from "../../services/telegramNotifications.js";
import { parseRotationAssignees, validateAssignees } from "../../services/assignmentRules.js";

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ruleSchema = z.object({
  generation_mode: z.enum(["always", "option_only", "disabled"]),
  schedule_mode: z.enum(["after_departure", "day_before_arrival", "arrival_day"]),
  default_assignee_id: z.string().nullable(),
  assignment_mode: z.enum(["unassigned", "fixed", "rotation"]),
  rotation_assignee_ids: z.array(z.string()).max(50),
  requires_check: z.boolean(),
  notify_on_complete: z.boolean(),
  reminder_minutes: z.number().int().min(0).max(10080),
  buffer_minutes: z.number().int().min(0).max(1440),
});
const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

const taskResponse = async (id: string) => {
  const task = await prisma.cleaningTask.findUnique({ where: { id } });
  if (!task) return null;
  const [gite, assignee, rule, arrival] = await Promise.all([
    prisma.gite.findUnique({ where: { id: task.gite_id }, select: { nom: true, heure_arrivee_defaut: true } }),
    task.assignee_id ? prisma.appUser.findUnique({ where: { id: task.assignee_id }, select: { display_name: true } }) : null,
    prisma.cleaningRule.findUnique({ where: { organization_id_gite_id: { organization_id: getOrganizationId(), gite_id: task.gite_id } } }),
    task.arrival_reservation_id ? prisma.reservation.findUnique({ where: { id: task.arrival_reservation_id }, select: { date_entree: true } }) : null,
  ]);
  return serializeCleaningTask(task, {
    gite: gite?.nom,
    assignee: assignee?.display_name,
    arrivalAt: arrival ? parisWallTime(formatDate(arrival.date_entree), gite?.heure_arrivee_defaut || "17:00") : null,
  }, rule?.requires_check ?? true);
};

router.get("/", async (req, res, next) => {
  try {
    const today = new Date();
    const query = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const from = query.from ?? formatDate(shiftDate(today, -14));
    const to = query.to ?? formatDate(shiftDate(today, 60));
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000 || from > to) {
      return res.status(400).json({ error: "La période doit couvrir au plus un an." });
    }
    await syncCleaningTasks(from, to);
    const user = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(user);
    const tasks = await prisma.cleaningTask.findMany({
      where: {
        ...(manager ? {} : { assignee_id: user?.id ?? "" }),
        OR: [
          { starts_at: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T23:59:59Z`) } },
          { due_at: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T23:59:59Z`) } },
        ],
      },
      orderBy: [{ starts_at: "asc" }, { createdAt: "asc" }],
    });
    const arrivalIds = [...new Set(tasks.map((task) => task.arrival_reservation_id).filter((id): id is string => Boolean(id)))];
    const [gites, users, rules, arrivals] = await Promise.all([
      prisma.gite.findMany({ select: { id: true, nom: true, heure_arrivee_defaut: true } }),
      manager ? prisma.appUser.findMany({ where: { is_active: true }, select: { id: true, display_name: true, status: true, intervenant_id: true } }) : [],
      prisma.cleaningRule.findMany(),
      arrivalIds.length ? prisma.reservation.findMany({ where: { id: { in: arrivalIds } }, select: { id: true, date_entree: true } }) : [],
    ]);
    const giteById = new Map(gites.map((item) => [item.id, item]));
    const arrivalById = new Map(arrivals.map((item) => [item.id, item]));
    const userById = new Map(users.map((item) => [item.id, item.display_name]));
    const ruleByGite = new Map(rules.map((item) => [item.gite_id, item]));
    return res.json({
      tasks: tasks.map((task) => {
        const arrival = task.arrival_reservation_id ? arrivalById.get(task.arrival_reservation_id) : null;
        return serializeCleaningTask(task, {
          gite: giteById.get(task.gite_id)?.nom,
          assignee: userById.get(task.assignee_id ?? "") ?? (task.assignee_id === user?.id ? user.displayName : null),
          arrivalAt: arrival ? parisWallTime(formatDate(arrival.date_entree), giteById.get(task.gite_id)?.heure_arrivee_defaut || "17:00") : null,
        }, ruleByGite.get(task.gite_id)?.requires_check ?? true);
      }),
      gites: manager ? gites : [],
      assignees: manager ? users.filter((item) => item.intervenant_id || item.status === "worker").map((item) => ({ id: item.id, name: item.display_name })) : [],
      rules: manager ? gites.map((gite) => {
        const rule = ruleByGite.get(gite.id);
        return { gite_id: gite.id, ...DEFAULT_CLEANING_RULE, ...rule,
          rotation_assignee_ids: rule ? parseRotationAssignees(rule.rotation_assignee_ids) : [] };
      }) : [],
      can_manage: manager,
    });
  } catch (error) { next(error); }
});

router.put("/rules/:giteId", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!canManageCleaning(user)) return res.status(403).json({ error: "Gestion des règles réservée aux gestionnaires." });
    const payload = ruleSchema.parse(req.body);
    const gite = await prisma.gite.findUnique({ where: { id: req.params.giteId }, select: { id: true } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });
    if (payload.default_assignee_id) {
      const assignee = await prisma.appUser.findUnique({ where: { id: payload.default_assignee_id }, select: { id: true, is_active: true, intervenant_id: true } });
      if (!assignee?.is_active || !assignee.intervenant_id) return res.status(400).json({ error: "Intervenant invalide." });
    }
    if (payload.assignment_mode === "fixed" && !payload.default_assignee_id) return res.status(400).json({ error: "Choisissez un intervenant habituel." });
    if (payload.assignment_mode === "rotation" && (!payload.rotation_assignee_ids.length || !await validateAssignees(payload.rotation_assignee_ids))) {
      return res.status(400).json({ error: "Choisissez des intervenants actifs pour la rotation." });
    }
    const stored = { ...payload, rotation_assignee_ids: JSON.stringify([...new Set(payload.rotation_assignee_ids)]) };
    const previous = await prisma.cleaningRule.findUnique({
      where: { organization_id_gite_id: { organization_id: getOrganizationId(), gite_id: gite.id } },
      select: { assignment_mode: true, rotation_assignee_ids: true },
    });
    const resetRotation = previous?.assignment_mode !== stored.assignment_mode
      || previous?.rotation_assignee_ids !== stored.rotation_assignee_ids;
    const rule = await prisma.cleaningRule.upsert({
      where: { organization_id_gite_id: { organization_id: getOrganizationId(), gite_id: gite.id } },
      create: { gite_id: gite.id, ...stored }, update: { ...stored, ...(resetRotation ? { rotation_cursor: 0 } : {}) },
    });
    return res.json(rule);
  } catch (error) { next(error); }
});

router.patch("/:id/assignment", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!canManageCleaning(user)) return res.status(403).json({ error: "Attribution réservée aux gestionnaires." });
    const { assignee_id } = z.object({ assignee_id: z.string().nullable() }).parse(req.body);
    const task = await prisma.cleaningTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Ménage introuvable." });
    const assignee = assignee_id ? await prisma.appUser.findUnique({ where: { id: assignee_id }, select: { is_active: true, intervenant_id: true } }) : null;
    if (assignee_id && (!assignee?.is_active || !assignee.intervenant_id)) return res.status(400).json({ error: "Intervenant invalide." });
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { assignee_id } });
    const departure = await prisma.reservation.findUnique({ where: { id: task.departure_reservation_id }, select: { date_sortie: true } });
    if (departure) {
      const day = formatDate(departure.date_sortie);
      const periods = await prisma.planningRelayPeriod.findMany({
        where: { date_debut: { lte: departure.date_sortie }, date_fin: { gte: departure.date_sortie } },
        select: { id: true, gite_ids: true },
      });
      const periodIds = periods.filter((period) => fromJsonString<string[]>(period.gite_ids, []).includes(task.gite_id)).map((period) => period.id);
      for (const periodId of periodIds) {
        if (assignee?.intervenant_id) {
          await prisma.planningRelayAssignment.upsert({
            where: { organization_id_period_id_date_gite_id: { organization_id: getOrganizationId(), period_id: periodId, date: day, gite_id: task.gite_id } },
            update: { worker_id: assignee.intervenant_id },
            create: { period_id: periodId, date: day, gite_id: task.gite_id, worker_id: assignee.intervenant_id },
          });
        } else {
          await prisma.planningRelayAssignment.deleteMany({ where: { period_id: periodId, date: day, gite_id: task.gite_id } });
        }
      }
    }
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/:id/note", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    const task = await prisma.cleaningTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Ménage introuvable." });
    if (!canManageCleaning(user) && task.assignee_id !== user?.id) {
      return res.status(403).json({ error: "Ce ménage ne vous est pas attribué." });
    }
    const { note } = z.object({ note: z.string().trim().max(2000) }).parse(req.body);
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { note } });
    return res.json(await taskResponse(task.id));
  } catch (error) { next(error); }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status, note } = z.object({
      status: z.enum(["planned", "in_progress", "done", "verified"]),
      note: z.string().trim().max(2000).optional(),
    }).parse(req.body);
    const user = await getAuthenticatedAppUser(req);
    const manager = canManageCleaning(user);
    const task = await prisma.cleaningTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "Ménage introuvable." });
    if (!manager && task.assignee_id !== user?.id) return res.status(403).json({ error: "Ce ménage ne vous est pas attribué." });
    if (!manager && status === "planned") return res.status(403).json({ error: "Action réservée au gestionnaire." });
    if (task.status === "verified" && !manager) return res.status(409).json({ error: "Ce ménage est déjà validé." });
    if (!manager && status === "verified" && task.status !== "done") return res.status(409).json({ error: "Terminez d’abord le ménage." });
    if (status === "in_progress" && task.status !== "planned" && !manager) return res.status(409).json({ error: "Ce ménage ne peut pas être démarré." });
    const rule = await prisma.cleaningRule.findUnique({ where: { organization_id_gite_id: { organization_id: getOrganizationId(), gite_id: task.gite_id } } });
    if (!manager && status === "verified" && (rule?.requires_check ?? true)) {
      return res.status(403).json({ error: "Le contrôle final est réservé au gestionnaire." });
    }
    const now = new Date();
    if (!manager && status === "done" && now < task.starts_at) return res.status(409).json({ error: "Le ménage n’est pas encore disponible." });
    const gite = await prisma.gite.findUnique({ where: { id: task.gite_id }, select: { id: true, nom: true, prefixe_contrat: true, ordre: true } });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });
    const shouldVerify = status === "verified" || (status === "done" && rule?.requires_check === false);
    if (shouldVerify || task.checked_at) {
      const [readiness] = await loadGiteCleaningReadiness([gite]);
      if (!readiness || readiness.departure_reservation_id !== task.departure_reservation_id) {
        return res.status(409).json({ error: "Ce contrôle n’est pas disponible pour le séjour actuel." });
      }
      if (shouldVerify && !isCleaningCheckAvailable(readiness, now)) {
        return res.status(409).json({ error: "Le contrôle sera disponible à partir du jour du départ." });
      }
      await updateGiteCleaningReadiness(readiness, shouldVerify, status === "verified" ? user?.id ?? null : null, now);
    }
    const nextStatus = shouldVerify ? "verified" : status;
    const updated = await prisma.cleaningTask.update({ where: { id: task.id }, data: {
      status: nextStatus, ...(note !== undefined ? { note } : {}),
      completed_at: nextStatus === "planned" || nextStatus === "in_progress" ? null : task.completed_at ?? now,
      completed_by_id: nextStatus === "planned" || nextStatus === "in_progress" ? null : task.completed_by_id ?? user?.id ?? null,
      checked_at: shouldVerify ? now : null,
      checked_by_id: shouldVerify ? user?.id ?? null : null,
    } });
    let notificationWarning: string | null = null;
    if (task.status !== nextStatus) {
      try {
        if (status === "done" && rule?.notify_on_complete) await notifyCleaningCompletedOnTelegram(gite.nom, now, user?.firstName);
        if (nextStatus === "verified") await notifyGiteCheckedOnTelegram(gite.nom, now, user?.firstName);
      } catch { notificationWarning = "État enregistré, mais la notification Telegram a échoué."; }
    }
    return res.json({ ...(await taskResponse(updated.id)), notification_warning: notificationWarning });
  } catch (error) { next(error); }
});

export default router;
