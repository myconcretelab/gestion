import crypto from "node:crypto";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { getOrganizationId } from "./organizationContext.js";
import { parisWallTime } from "./cleaningTasks.js";
import { readTelegramNotificationConfig } from "./telegramNotifications.js";
import {
  readTaskReminderSettings,
  type TaskReminderSettings,
} from "./taskReminderSettings.js";
import { sendMessage } from "./messageChannels/index.js";

export const taskUrgencyData = (level: number, now = new Date()) => ({
  urgency_level: level,
  urgency_requested_at: level ? now : null,
  urgency_departure_id: null,
  urgency_starts_at: null,
  urgency_first_sent_at: null,
  urgency_last_sent_at: null,
  urgency_stopped_at: null,
  urgency_version: crypto.randomUUID(),
});

export const validateTaskUrgency = async (level: number, category: string) => {
  if (!level) return;
  if (category !== "short")
    throw Object.assign(
      new Error("L’urgence est réservée aux tâches rapides."),
      { status: 400 },
    );
  const settings = await readTaskReminderSettings();
  if (
    !settings.enabled ||
    !(level === 1 ? settings.level_1_enabled : settings.level_2_enabled)
  ) {
    throw Object.assign(
      new Error(
        "Ce niveau d’urgence est désactivé dans les paramètres des tâches.",
      ),
      { status: 409 },
    );
  }
};

export const taskReminderTokenSchema = z
  .object({
    organization_id: z.string().min(1).max(200),
    task_id: z.string().min(1).max(200).nullable(),
    gite_id: z.string().min(1).max(200),
    recipient_id: z.string().min(1).max(200),
    version: z.string().max(100),
    action: z.enum(["done", "stop", "view"]),
    issued_at: z.number().int().positive(),
    expires_at: z.number().int().positive(),
  })
  .refine((value) =>
    value.action === "view"
      ? value.task_id === null
      : Boolean(value.task_id && value.version),
  );
export type TaskReminderToken = z.infer<typeof taskReminderTokenSchema>;
const signature = (data: string, secret: string) =>
  crypto
    .createHmac("sha256", secret)
    .update(`task-reminder:v1:${data}`)
    .digest("base64url");
export const buildTaskReminderToken = (
  payload: TaskReminderToken,
  secret: string,
) => {
  if (!secret) throw new Error("Telegram n’est pas configuré.");
  const data = Buffer.from(
    JSON.stringify(taskReminderTokenSchema.parse(payload)),
  ).toString("base64url");
  return `${data}.${signature(data, secret)}`;
};
export const decodeTaskReminderToken = (token: string) => {
  if (token.length > 3000) return null;
  try {
    return taskReminderTokenSchema.parse(
      JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
      ),
    );
  } catch {
    return null;
  }
};
export const parseTaskReminderToken = (
  token: string,
  secret: string,
  now = new Date(),
) => {
  const payload = decodeTaskReminderToken(token);
  const [data, actual, extra] = token.split(".");
  if (
    !payload ||
    !secret ||
    !actual ||
    extra ||
    payload.expires_at <= now.getTime() ||
    payload.issued_at > now.getTime() + 60_000
  )
    return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(actual)) return null;
  const expected = signature(data, secret);
  return actual.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    ? payload
    : null;
};

type ReminderUser = {
  id: string;
  is_active: boolean;
  telegram_chat_id: string | null;
  gestionnaire_id: string | null;
  is_owner: boolean;
};
type ReminderGite = {
  id: string;
  nom: string;
  gestionnaire_id: string | null;
  heure_depart_defaut: string;
};
export const resolveTaskReminderRecipient = (
  task: { assignee_id: string | null; created_by_id?: string | null },
  gite: Pick<ReminderGite, "gestionnaire_id">,
  users: ReminderUser[],
  settings: TaskReminderSettings,
) => {
  const available = users.filter(
    (user) => user.is_active && user.telegram_chat_id?.trim(),
  );
  return (
    (settings.recipient_policy === "creator_first"
      ? available.find((user) => user.id === task.created_by_id)
      : null) ??
    (settings.recipient_policy !== "manager_only"
      ? available.find((user) => user.id === task.assignee_id)
      : null) ??
    (gite.gestionnaire_id
      ? available.find((user) => user.gestionnaire_id === gite.gestionnaire_id)
      : null) ??
    available.find((user) => user.id === settings.fallback_user_id) ??
    available.find((user) => user.is_owner) ??
    null
  );
};

export const escapeTaskHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export const taskReminderUrl = (payload: TaskReminderToken, secret: string) =>
  `${env.CLIENT_ORIGIN.replace(/\/$/, "")}/api/public/task-reminders/action?token=${encodeURIComponent(buildTaskReminderToken(payload, secret))}`;

export const findTaskUrgencyDeparture = (
  requestedAt: Date,
  departures: Array<{ id: string; date_sortie: Date }>,
  departureTimes: Map<string, string>,
  defaultTime: string,
) =>
  departures
    .map((reservation) => {
      const configured = departureTimes.get(reservation.id) || defaultTime;
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(configured)
        ? configured
        : "12:00";
      return {
        id: reservation.id,
        at: parisWallTime(
          reservation.date_sortie.toISOString().slice(0, 10),
          time,
        ),
      };
    })
    .filter((departure) => departure.at >= requestedAt)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;

export const isTaskUrgencyDue = (
  task: {
    urgency_level: number;
    urgency_stopped_at: Date | null;
    urgency_first_sent_at: Date | null;
    urgency_last_sent_at: Date | null;
    urgency_starts_at: Date | null;
    status: string;
  },
  settings: TaskReminderSettings,
  now: Date,
) => {
  if (
    !settings.enabled ||
    task.status === "done" ||
    task.urgency_stopped_at ||
    !task.urgency_starts_at ||
    task.urgency_starts_at > now
  )
    return false;
  if (task.urgency_level === 1)
    return settings.level_1_enabled && !task.urgency_first_sent_at;
  if (task.urgency_level !== 2 || !settings.level_2_enabled) return false;
  return (
    !task.urgency_last_sent_at ||
    now.getTime() - task.urgency_last_sent_at.getTime() >=
      settings.repeat_interval_minutes * 60_000
  );
};

export const runTaskUrgencyReminders = async (
  now = new Date(),
  deliver = sendMessage,
) => {
  const settings = await readTaskReminderSettings();
  const telegram = readTelegramNotificationConfig();
  const result = { sent_count: 0, failed_count: 0, waiting_count: 0 };
  if (
    !settings.enabled ||
    !telegram.enabled ||
    !telegram.bot_token ||
    !env.CLIENT_ORIGIN
  )
    return result;
  const tasks = await prisma.actionTask.findMany({
    where: {
      urgency_level: { in: [1, 2] },
      category: "short",
      status: { not: "done" },
      urgency_stopped_at: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!tasks.length) return result;
  const giteIds = [...new Set(tasks.map((task) => task.gite_id))];
  const earliest = new Date(
    Math.min(
      ...tasks.map((task) =>
        (task.urgency_requested_at ?? task.createdAt).getTime(),
      ),
    ) - 86_400_000,
  );
  const [gites, users, reservations, contracts] = await Promise.all([
    prisma.gite.findMany({
      where: { id: { in: giteIds } },
      select: {
        id: true,
        nom: true,
        gestionnaire_id: true,
        heure_depart_defaut: true,
      },
    }),
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
    prisma.reservation.findMany({
      where: { gite_id: { in: giteIds }, date_sortie: { gte: earliest } },
      select: { id: true, gite_id: true, date_sortie: true },
    }),
    prisma.contrat.findMany({
      where: {
        gite_id: { in: giteIds },
        reservation_id: { not: null },
        date_fin: { gte: earliest },
      },
      select: { reservation_id: true, heure_depart: true },
      orderBy: [{ date_creation: "desc" }, { id: "desc" }],
    }),
  ]);
  const departureTimes = new Map<string, string>();
  for (const contract of contracts)
    if (contract.reservation_id && !departureTimes.has(contract.reservation_id))
      departureTimes.set(contract.reservation_id, contract.heure_depart);
  type Task = (typeof tasks)[number];
  const groups = new Map<
    string,
    { gite: ReminderGite; recipient: ReminderUser; tasks: Task[] }
  >();
  for (const original of tasks) {
    const task = { ...original };
    const gite = gites.find((row) => row.id === task.gite_id);
    if (!gite) continue;
    // Until the first delivery, follow changes/cancellations in the reservation calendar.
    if (!task.urgency_first_sent_at) {
      const departure = findTaskUrgencyDeparture(
        task.urgency_requested_at ?? task.createdAt,
        reservations.filter((row) => row.gite_id === task.gite_id),
        departureTimes,
        gite.heure_depart_defaut,
      );
      task.urgency_starts_at = departure?.at ?? null;
      task.urgency_departure_id = departure?.id ?? null;
      if (
        task.urgency_starts_at?.getTime() !==
          original.urgency_starts_at?.getTime() ||
        task.urgency_departure_id !== original.urgency_departure_id
      ) {
        await prisma.actionTask.updateMany({
          where: {
            id: task.id,
            urgency_version: task.urgency_version,
            status: { not: "done" },
          },
          data: {
            urgency_starts_at: task.urgency_starts_at,
            urgency_departure_id: task.urgency_departure_id,
          },
        });
      }
    }
    if (!isTaskUrgencyDue(task, settings, now)) {
      result.waiting_count++;
      continue;
    }
    const recipient = resolveTaskReminderRecipient(task, gite, users, settings);
    if (!recipient) {
      result.waiting_count++;
      continue;
    }
    const key = `${gite.id}:${recipient.id}`;
    const group = groups.get(key) ?? { gite, recipient, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    // Recheck after asynchronous reads so a completed or muted task is not picked from a stale snapshot.
    const live = await prisma.actionTask.findMany({
      where: {
        id: { in: group.tasks.map((task) => task.id) },
        status: { not: "done" },
        urgency_stopped_at: null,
      },
    });
    const due = group.tasks.filter((task) =>
      live.some(
        (row) =>
          row.id === task.id &&
          row.urgency_version === task.urgency_version &&
          isTaskUrgencyDue(row, settings, now),
      ),
    );
    if (!due.length) continue;
    const tokenBase = {
      organization_id: getOrganizationId(),
      gite_id: group.gite.id,
      recipient_id: group.recipient.id,
      issued_at: now.getTime(),
      expires_at: now.getTime() + settings.link_validity_days * 86_400_000,
    };
    const detailed = due.length <= 20;
    const lines = due
      .slice(0, 20)
      .map(
        (task, index) =>
          `${index + 1}. ${task.urgency_level === 2 ? "🚨" : "🔔"} ${escapeTaskHtml(task.title.slice(0, 120))}`,
      );
    const message = [
      `<b>${escapeTaskHtml(settings.message_heading)}</b>`,
      `<b>${escapeTaskHtml(group.gite.nom.slice(0, 150))}</b>`,
      "",
      ...lines,
      ...(!detailed ? [`… et ${due.length - 20} autre(s) tâche(s).`] : []),
      "",
      "Les locataires sont partis : vous pouvez intervenir.",
      ...(due.some((task) => task.urgency_level === 2)
        ? [
            `🚨 Rappel toutes les ${settings.repeat_interval_minutes} minutes, jusqu’à validation ou arrêt des rappels.`,
          ]
        : []),
    ].join("\n");
    const keyboard = detailed
      ? due.map((task, index) => [
          {
            text: `${due.length > 1 ? `${index + 1}. ` : ""}${settings.done_button_label}`,
            url: taskReminderUrl(
              {
                ...tokenBase,
                task_id: task.id,
                version: task.urgency_version,
                action: "done",
              },
              telegram.bot_token,
            ),
          },
          ...(task.urgency_level === 2
            ? [
                {
                  text: `${due.length > 1 ? `${index + 1}. ` : ""}${settings.stop_button_label}`,
                  url: taskReminderUrl(
                    {
                      ...tokenBase,
                      task_id: task.id,
                      version: task.urgency_version,
                      action: "stop",
                    },
                    telegram.bot_token,
                  ),
                },
              ]
            : []),
        ])
      : [
          [
            {
              text: `Voir les ${due.length} tâches et leurs boutons`,
              url: taskReminderUrl(
                { ...tokenBase, task_id: null, version: "", action: "view" },
                telegram.bot_token,
              ),
            },
          ],
        ];
    try {
      const delivery = await deliver("telegram", {
        message,
        recipients: [group.recipient.telegram_chat_id!.trim()],
        options: {
          ...telegram,
          has_explicit_recipients: true,
          reply_markup: { inline_keyboard: keyboard },
        },
      });
      if (delivery.sent_count > 0) {
        for (const task of due)
          await prisma.actionTask.updateMany({
            where: { id: task.id, urgency_version: task.urgency_version },
            data: {
              urgency_first_sent_at: task.urgency_first_sent_at ?? now,
              urgency_last_sent_at: now,
            },
          });
        result.sent_count++;
      }
    } catch {
      result.failed_count++;
      // Provider errors may include the bot token. Never persist or print their raw text.
      console.error("Échec d’un rappel de tâche Telegram", {
        organizationId: getOrganizationId(),
        giteId: group.gite.id,
      });
    }
  }
  return result;
};
