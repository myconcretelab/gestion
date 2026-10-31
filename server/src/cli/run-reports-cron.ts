import prisma from "../db/prisma.js";
import { runReportAutomationTick } from "../services/reportAutomation.js";

try {
  const outcomes = await runReportAutomationTick();
  const failed = outcomes.filter(
    (outcome) => outcome.status === "failed",
  ).length;
  console.log(
    `Rapports mensuels : comptes=${outcomes.length}, échecs=${failed}`,
  );
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(
    "[reports-cron]",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
