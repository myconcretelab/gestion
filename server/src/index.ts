import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startPumpCron } from "./services/pumpCron.js";

const app = createApp();

if (env.NODE_ENV !== "test") {
  startPumpCron();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
