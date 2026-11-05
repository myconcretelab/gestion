import { env } from "../config/env.js";
import prisma from "../db/prisma.js";
import { runTenantTaskAcrossOrganizations } from "../modules/system/tenantTasks.js";
import { getReportWorkspace } from "../modules/finance/reports/service.js";
import {
  REPORT_CACHE_VERSION,
  reportCalculationMonth,
} from "../modules/finance/reports/cache.js";

/** First run after a month boundary (or restart) catches up all closed periods. */
export async function runMonthlyReportCalculation(now = new Date()) {
  const year = Number(reportCalculationMonth(now).slice(0, 4));
  let calculated = false;
  // Previous-year closing periods remain available after New Year, in a separate cache.
  for (const scopeYear of [year - 1, year]) {
    const cache = await prisma.financeReportYearCache.findFirst({
      where: { year: scopeYear },
      select: {
        calculated_at: true,
        calculated_month: true,
        engine_version: true,
      },
    });
    if (
      cache?.calculated_at &&
      cache.calculated_month === reportCalculationMonth(now) &&
      cache.engine_version === REPORT_CACHE_VERSION
    )
      continue;
    await getReportWorkspace({ force: true, now, year: scopeYear });
    calculated = true;
  }
  return { calculated };
}

export const runReportAutomationTick = (now = new Date()) =>
  runTenantTaskAcrossOrganizations({
    taskKey: "automation.finance_reports",
    moduleKeys: ["finances"],
    handler: () => runMonthlyReportCalculation(now),
    leaseMs: 10 * 60_000,
    minimumIntervalMs: 60_000,
    now,
  });

let timer: NodeJS.Timeout | null = null;
let running = false;
export function startReportAutomationScheduler() {
  if (env.NODE_ENV === "test" || !env.REPORT_AUTOMATION_ENABLED || timer)
    return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runReportAutomationTick()
      .catch(() => console.error("Échec du calcul mensuel des rapports."))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
}
export function stopReportAutomationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
