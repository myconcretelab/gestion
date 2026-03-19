import prisma from "../db/prisma.js";
import { runScheduledIcalSync } from "../services/icalSync.js";

const main = async () => {
  const outcome = await runScheduledIcalSync();

  if (outcome.status === "success") {
    const result = outcome.result;
    console.log(
      `iCal cron OK: ajoutees=${result?.created_count ?? 0}, mises_a_jour=${result?.updated_count ?? 0}, ignorees=${result?.skipped_count ?? 0}`
    );
    return;
  }

  console.log(`iCal cron ignore: ${outcome.status}`);
};

main()
  .catch((error) => {
    console.error("[ical-sync-cron]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
