import { env } from "../config/env.js";
import { runTenantTaskAcrossOrganizations } from "../modules/system/tenantTasks.js";
import { runTaskUrgencyReminders } from "./taskUrgency.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export const runTaskUrgencyAutomationTick = (now = new Date()) =>
  runTenantTaskAcrossOrganizations({
    taskKey: "automation.task_urgency",
    moduleKeys: ["telegram", "worker_planning"],
    handler: () => runTaskUrgencyReminders(now),
    leaseMs: 10 * 60_000,
    minimumIntervalMs: 45_000,
    now,
  });

export const startTaskUrgencyAutomationScheduler = () => {
  if (env.NODE_ENV === "test" || !env.TASK_URGENCY_AUTOMATION_ENABLED || timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runTaskUrgencyAutomationTick()
      .catch(() => console.error("Échec du contrôle des tâches urgentes."))
      .finally(() => { running = false; });
  }, 60_000);
  timer.unref();
};

export const stopTaskUrgencyAutomationScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
