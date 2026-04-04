import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startDailyReservationEmailCron } from "./services/dailyReservationEmail.js";
import { startPumpCron } from "./services/pumpCron.js";

const app = createApp();

if (env.NODE_ENV !== "test") {
  startPumpCron();
  startDailyReservationEmailCron();
}

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
