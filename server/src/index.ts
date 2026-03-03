import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startIcalSyncCron } from "./services/icalSync.js";

const app = createApp();

if (env.NODE_ENV !== "test") {
  startIcalSyncCron();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
