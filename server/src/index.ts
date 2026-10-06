import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startDailyReservationEmailCron } from "./services/dailyReservationEmail.js";
import { startPumpCron } from "./services/pumpCron.js";
import { startSmartlifeAutomationCron } from "./services/smartlifeAutomation.js";
import { startGitePhotosWordPressWebhookQueue } from "./services/bookedWordPressWebhook.js";
import { startTelegramDeadlineNotificationCron } from "./services/telegramDeadlineNotifications.js";
import { startPlanningRelaySmsCron } from "./services/planningRelaySms.js";
import { assertProductionAuthConfigured } from "./services/serverAuth.js";
import { ensureLegacyIntegrationTokenMigrated } from "./services/apiTokens.js";
import { isModuleEnabled } from "./services/installationConfig.js";

await assertProductionAuthConfigured();
await ensureLegacyIntegrationTokenMigrated();

const app = createApp();

if (env.NODE_ENV !== "test") {
  if (await isModuleEnabled("pump_airbnb")) startPumpCron();
  if (await isModuleEnabled("daily_email")) startDailyReservationEmailCron();
  if (await isModuleEnabled("smart_life")) startSmartlifeAutomationCron();
  if (await isModuleEnabled("web_publication")) startGitePhotosWordPressWebhookQueue();
  if (await isModuleEnabled("telegram")) startTelegramDeadlineNotificationCron();
  if (await isModuleEnabled("sms") && await isModuleEnabled("worker_planning")) startPlanningRelaySmsCron();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
