import { startBookingPaymentsWorker } from "./modules/bookingPayments/service.js";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { assertProductionAuthConfigured } from "./services/serverAuth.js";
import { ensureLegacyIntegrationTokenMigrated } from "./services/apiTokens.js";
import { startBillingJobWorker } from "./modules/billing/worker.js";
import { startSuperPdpJobWorker } from "./modules/superpdp/worker.js";
import { startMultiTenantAutomationScheduler } from "./services/multiTenantAutomation.js";
import { startTaskUrgencyAutomationScheduler } from "./services/taskUrgencyAutomation.js";
import { startReportAutomationScheduler } from "./services/reportAutomation.js";

import { startOwnerNotificationWorker } from "./services/ownerNotifications.js";
import { startOwnerDeadlineNotificationScheduler } from "./services/telegramDeadlineNotifications.js";

await assertProductionAuthConfigured();
await ensureLegacyIntegrationTokenMigrated();

const app = createApp();

if (env.NODE_ENV !== "test") {
  startBookingPaymentsWorker();
  startOwnerNotificationWorker();
  startOwnerDeadlineNotificationScheduler();
  startBillingJobWorker();
  startSuperPdpJobWorker();
  startMultiTenantAutomationScheduler();
  startTaskUrgencyAutomationScheduler();
  startReportAutomationScheduler();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
