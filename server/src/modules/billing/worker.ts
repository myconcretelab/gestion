import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { systemPrisma } from "../../db/prisma.js";
import { runOrganizationJobBatch, type OrganizationJobHandler } from "../system/jobs.js";
import { processVerifiedBillingEvent } from "./service.js";
import { getStripeBillingProvider } from "./stripe.js";

const reconcileBilling: OrganizationJobHandler = async (job) => {
  const subscription = await systemPrisma.subscription.findUnique({ where: { organization_id: job.organization_id } });
  if (!subscription?.provider || !subscription.provider_subscription_id) throw new Error("Abonnement fournisseur incomplet.");
  const provider = subscription.provider === "stripe" ? getStripeBillingProvider() : null;
  if (!provider) throw new Error("Fournisseur de facturation non configuré.");
  const events = await provider.reconcile(subscription.provider_subscription_id);
  const results = [];
  for (const event of events) results.push(await processVerifiedBillingEvent(provider.name, event));
  return { reconciledEvents: results.length, duplicateEvents: results.filter((item) => item.duplicate).length };
};

export const billingJobHandlers = { "billing.reconcile": reconcileBilling };

export const runBillingJobBatch = (workerId = `billing-${process.pid}-${crypto.randomUUID()}`) => runOrganizationJobBatch({
  workerId,
  leaseMs: env.ORGANIZATION_JOB_LEASE_MS,
  maxAttempts: env.ORGANIZATION_JOB_MAX_ATTEMPTS,
  handlers: billingJobHandlers,
});

let timer: NodeJS.Timeout | null = null;
let running = false;
export const startBillingJobWorker = () => {
  if (!env.ORGANIZATION_JOB_WORKER_ENABLED || timer) return;
  const workerId = `billing-${process.pid}-${crypto.randomUUID()}`;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runBillingJobBatch(workerId); }
    finally { running = false; }
  };
  void tick();
  timer = setInterval(() => void tick(), env.ORGANIZATION_JOB_POLL_MS);
  timer.unref();
};

export const stopBillingJobWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
