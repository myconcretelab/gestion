import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { assertProductionAuthConfigured } from "./services/serverAuth.js";
import { ensureLegacyIntegrationTokenMigrated } from "./services/apiTokens.js";
import { startBillingJobWorker } from "./modules/billing/worker.js";
import { startMultiTenantAutomationScheduler } from "./services/multiTenantAutomation.js";

await assertProductionAuthConfigured();
await ensureLegacyIntegrationTokenMigrated();

const app = createApp();

if (env.NODE_ENV !== "test") {
  startBillingJobWorker();
  startMultiTenantAutomationScheduler();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
