import { Router, urlencoded } from "express";
import { z } from "zod";
import prisma, { systemPrisma } from "../../db/prisma.js";
import { runWithOrganization } from "../../services/organizationContext.js";
import { isModuleEnabled } from "../../services/installationConfig.js";
import { readTelegramNotificationConfig } from "../../services/telegramNotifications.js";
import { readTaskReminderSettings } from "../../services/taskReminderSettings.js";
import { recordActionTaskCompensation } from "../../services/actionTasks.js";
import {
  decodeTaskReminderToken,
  parseTaskReminderToken,
  escapeTaskHtml,
  resolveTaskReminderRecipient,
  taskReminderUrl,
  type TaskReminderToken,
} from "../../services/taskUrgency.js";

const router = Router();
router.use(urlencoded({ extended: false, limit: "8kb" }));
const problem = (
  message = "Ce lien n’est plus disponible. Retrouvez la tâche dans l’application.",
) => Object.assign(new Error(message), { status: 410 });
const render = (
  title: string,
  body: string,
) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeTaskHtml(title)}</title><style>
body{font-family:system-ui,sans-serif;background:#f5f7f5;color:#1e332c;min-height:100vh;margin:0;display:grid;place-items:center}main{box-sizing:border-box;width:min(100% - 32px,520px);padding:32px;border:1px solid #dfebe4;border-radius:28px;background:#fff;box-shadow:0 16px 60px #18392b10;margin:24px}h1{font-size:25px;line-height:1.2}h2{font-size:18px;margin:0 0 12px}p{line-height:1.6;color:#53675f}button,a.button{display:block;box-sizing:border-box;width:100%;padding:15px 20px;background:#315e4d;color:white;font:inherit;font-weight:700;border:0;border-radius:16px;text-align:center;text-decoration:none;cursor:pointer;margin-top:16px}.secondary{background:#edf3ef!important;color:#315e4d!important}label{display:grid;gap:8px;margin:16px 0}input{padding:14px;font:inherit;border:1px solid #cddcd3;border-radius:12px;max-width:100%;box-sizing:border-box}.tag{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#648273}article{padding:18px 0;border-top:1px solid #e4ebe7}.icon{font-size:38px}</style></head><body><main><span class="tag">Tâches du gîte · Telegram</span><h1>${escapeTaskHtml(title)}</h1>${body}</main></body></html>`;

async function withToken<T>(
  token: string,
  callback: (payload: TaskReminderToken) => Promise<T>,
) {
  const decoded = decodeTaskReminderToken(token);
  if (!decoded) throw problem();
  return runWithOrganization(
    { organizationId: decoded.organization_id, source: "public-token" },
    async () => {
      if (
        !(await systemPrisma.organization.findFirst({
          where: { id: decoded.organization_id, status: "active" },
          select: { id: true },
        }))
      )
        throw problem();
      const payload = parseTaskReminderToken(
        token,
        readTelegramNotificationConfig().bot_token,
      );
      if (!payload) throw problem();
      if (
        !(await isModuleEnabled("worker_planning")) ||
        !(await isModuleEnabled("telegram"))
      )
        throw problem();
      return callback(payload);
    },
  );
}

async function authorizedTasks(payload: TaskReminderToken) {
  const [settings, users, gite, tasks] = await Promise.all([
    readTaskReminderSettings(),
    prisma.appUser.findMany({
      where: { is_active: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        is_active: true,
        telegram_chat_id: true,
        gestionnaire_id: true,
        is_owner: true,
      },
    }),
    prisma.gite.findUnique({
      where: { id: payload.gite_id },
      select: { nom: true, gestionnaire_id: true },
    }),
    prisma.actionTask.findMany({
      where: {
        gite_id: payload.gite_id,
        ...(payload.task_id
          ? { id: payload.task_id, urgency_version: payload.version }
          : {
              category: "short",
              urgency_level: { in: [1, 2] },
              status: { not: "done" },
              createdAt: { lte: new Date(payload.issued_at) },
            }),
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!gite) throw problem();
  const authorized = tasks.filter(
    (task) =>
      task.urgency_level > 0 &&
      resolveTaskReminderRecipient(task, gite, users, settings)?.id ===
        payload.recipient_id,
  );
  if (payload.task_id && !authorized.length) throw problem();
  return { tasks: authorized, settings, gite };
}

router.get("/action", async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const page = await withToken(token, async (payload) => {
      const { tasks, settings, gite } = await authorizedTasks(payload);
      if (payload.action === "view") {
        const secret = readTelegramNotificationConfig().bot_token;
        return render(
          gite.nom,
          `<p>${tasks.length} tâche(s) à faire. Choisissez une action pour chaque tâche.</p>${tasks.map((task) => `<article><h2>${escapeTaskHtml(task.title)}</h2><a class="button" href="${escapeTaskHtml(taskReminderUrl({ ...payload, task_id: task.id, version: task.urgency_version, action: "done" }, secret))}">${escapeTaskHtml(settings.done_button_label)}</a>${task.urgency_level === 2 && !task.urgency_stopped_at ? `<a class="button secondary" href="${escapeTaskHtml(taskReminderUrl({ ...payload, task_id: task.id, version: task.urgency_version, action: "stop" }, secret))}">${escapeTaskHtml(settings.stop_button_label)}</a>` : ""}</article>`).join("")}`,
        );
      }
      const task = tasks[0];
      if (task.status === "done")
        return render(
          "Déjà fait, merci !",
          `<div class="icon">✅</div><p>${escapeTaskHtml(task.title)} est déjà terminée. Les rappels sont arrêtés.</p>`,
        );
      if (payload.action === "stop" && task.urgency_level !== 2)
        throw problem();
      if (payload.action === "stop" && task.urgency_stopped_at)
        return render(
          "Rappels déjà arrêtés",
          "<p>La tâche reste dans la liste des choses à faire.</p>",
        );
      if (
        task.compensation_mode !== "none" &&
        !task.assignee_id &&
        payload.action === "done"
      ) {
        return render(
          "Intervenant à préciser",
          `<p>Cette tâche est rémunérée. Attribuez-la d’abord à son intervenant dans l’application pour enregistrer correctement sa réalisation.</p>`,
        );
      }
      return render(
        payload.action === "done"
          ? "C’est fait ?"
          : "Mettre les rappels en pause ?",
        `<h2>${escapeTaskHtml(task.title)}</h2><p>${escapeTaskHtml(gite.nom)}</p>${task.note ? `<p>${escapeTaskHtml(task.note).replace(/\n/g, "<br>")}</p>` : ""}<p>${payload.action === "done" ? "La tâche sera marquée comme terminée et ses rappels s’arrêteront." : "Les rappels s’arrêteront. La tâche restera à faire."}</p><form method="post" action="/api/public/task-reminders/action"><input type="hidden" name="token" value="${escapeTaskHtml(token)}">${payload.action === "done" && task.compensation_mode === "time" ? '<label>Temps réellement passé (minutes)<input name="spent_minutes" type="number" min="1" max="1440" required inputmode="numeric"></label>' : ""}<button type="submit">${escapeTaskHtml(payload.action === "done" ? settings.done_button_label : settings.stop_button_label)}</button></form>`,
      );
    });
    return res.type("html").send(page);
  } catch (error) {
    if ((error as { status?: number }).status === 410)
      return res
        .status(410)
        .type("html")
        .send(
          render(
            "Lien indisponible",
            `<p>${escapeTaskHtml((error as Error).message)}</p>`,
          ),
        );
    next(error);
  }
});

router.post("/action", async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const body = z
      .object({
        token: z.string().max(3000),
        spent_minutes: z.coerce.number().int().min(1).max(1440).optional(),
      })
      .parse(req.body);
    const page = await withToken(body.token, async (payload) => {
      if (payload.action === "view") throw problem();
      const { tasks } = await authorizedTasks(payload);
      const task = tasks[0];
      if (task.status === "done")
        return render(
          "Déjà fait, merci !",
          "<p>Cette tâche est déjà terminée. Ses rappels sont arrêtés.</p>",
        );
      if (payload.action === "stop") {
        if (task.urgency_level !== 2) throw problem();
        await prisma.actionTask.updateMany({
          where: {
            id: task.id,
            urgency_version: payload.version,
            status: { not: "done" },
            urgency_stopped_at: null,
          },
          data: { urgency_stopped_at: new Date() },
        });
        return render(
          "Rappels arrêtés",
          `<div class="icon">🔕</div><p>${escapeTaskHtml(task.title)} reste à faire. Vous ne recevrez plus ses rappels.</p>`,
        );
      }
      await prisma.$transaction(async (tx) => {
        const current = await tx.actionTask.findFirst({
          where: { id: task.id, urgency_version: payload.version },
        });
        if (!current) throw problem();
        if (current.status === "done") return;
        const now = new Date();
        const changed = await tx.actionTask.updateMany({
          where: {
            id: current.id,
            urgency_version: payload.version,
            status: { not: "done" },
          },
          data: {
            status: "done",
            completed_at: now,
            completed_by_id: payload.recipient_id,
          },
        });
        if (!changed.count) return;
        const { spentMinutes } = await recordActionTaskCompensation(
          current,
          now,
          body.spent_minutes,
          tx,
        );
        await tx.actionTask.update({
          where: { id: current.id },
          data: { spent_minutes: spentMinutes ?? null },
        });
      });
      return render(
        "C’est fait, merci !",
        `<div class="icon">✅</div><p>${escapeTaskHtml(task.title)} est terminée. Ses rappels sont arrêtés.</p>`,
      );
    });
    return res.type("html").send(page);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 410 || status === 409)
      return res
        .status(status)
        .type("html")
        .send(
          render(
            "Action indisponible",
            `<p>${escapeTaskHtml((error as Error).message)}</p>`,
          ),
        );
    next(error);
  }
});

export default router;
