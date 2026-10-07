import prisma from "../db/prisma.js";
import { runScheduledIcalSync } from "../services/icalSync.js";
import { runTenantTaskAcrossOrganizations } from "../modules/system/tenantTasks.js";

const main = async () => {
  const outcomes = await runTenantTaskAcrossOrganizations({
    taskKey: "automation.ical.external",
    moduleKeys: ["ical"],
    leaseMs: 60 * 60_000,
    handler: async () => runScheduledIcalSync(),
  });
  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  console.log(`iCal cron multi-tenant: organisations_ok=${succeeded}, organisations_erreur=${failed}, total=${outcomes.length}`);
};

main()
  .catch((error) => {
    console.error("[ical-sync-cron]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
