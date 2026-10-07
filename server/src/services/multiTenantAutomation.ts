import { env } from "../config/env.js";
import { runTenantTaskAcrossOrganizations } from "../modules/system/tenantTasks.js";
import { runGitePhotosWordPressWebhookQueueOnce } from "./bookedWordPressWebhook.js";
import { runDailyReservationEmail } from "./dailyReservationEmail.js";
import { runScheduledIcalSync } from "./icalSync.js";
import { runPlanningRelaySmsSchedule } from "./planningRelaySms.js";
import { runConfiguredPumpCronImport } from "./pumpCron.js";
import { runSmartlifeAutomation } from "./smartlifeAutomation.js";
import { runTelegramDeadlineNotifications } from "./telegramDeadlineNotifications.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

export const runMultiTenantAutomationTick = async () => {
  const taskResults = [];
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.smartlife", moduleKeys: ["smart_life"], handler: () => runSmartlifeAutomation({ triggered_by: "scheduler" }), leaseMs: 10 * 60_000, minimumIntervalMs: 45_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.daily_email", moduleKeys: ["daily_email"], handler: () => runDailyReservationEmail({ triggered_by: "scheduler" }), leaseMs: 10 * 60_000, minimumIntervalMs: 45_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.telegram", moduleKeys: ["telegram"], handler: () => runTelegramDeadlineNotifications(), leaseMs: 10 * 60_000, minimumIntervalMs: 5 * 60_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.planning_sms", moduleKeys: ["sms", "worker_planning"], handler: () => runPlanningRelaySmsSchedule(), leaseMs: 10 * 60_000, minimumIntervalMs: 45_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.wordpress", moduleKeys: ["web_publication"], handler: () => runGitePhotosWordPressWebhookQueueOnce(), leaseMs: 10 * 60_000, minimumIntervalMs: 45_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.ical", moduleKeys: ["ical"], handler: () => runScheduledIcalSync(), leaseMs: 60 * 60_000, minimumIntervalMs: env.ICAL_SYNC_INTERVAL_HOURS * 60 * 60_000 }));
  taskResults.push(await runTenantTaskAcrossOrganizations({ taskKey: "automation.pump", moduleKeys: ["pump_airbnb"], handler: () => runConfiguredPumpCronImport(), leaseMs: 60 * 60_000, minimumIntervalMs: env.PUMP_IMPORT_CRON_INTERVAL_DAYS * 24 * 60 * 60_000 }));
  return taskResults.flat();
};

export const startMultiTenantAutomationScheduler = () => {
  if (!env.MULTITENANT_AUTOMATION_ENABLED || timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runMultiTenantAutomationTick(); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
};

export const stopMultiTenantAutomationScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
