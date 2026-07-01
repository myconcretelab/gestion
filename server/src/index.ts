import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startDailyReservationEmailCron } from "./services/dailyReservationEmail.js";
import { startPumpCron } from "./services/pumpCron.js";
import { startSmartlifeAutomationCron } from "./services/smartlifeAutomation.js";
import { startGitePhotosWordPressWebhookQueue } from "./services/bookedWordPressWebhook.js";
import { startTelegramDeadlineNotificationCron } from "./services/telegramDeadlineNotifications.js";

const app = createApp();

if (env.NODE_ENV !== "test") {
  startPumpCron();
  startDailyReservationEmailCron();
  startSmartlifeAutomationCron();
  startGitePhotosWordPressWebhookQueue();
  startTelegramDeadlineNotificationCron();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
