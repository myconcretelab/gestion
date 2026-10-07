CREATE TABLE IF NOT EXISTS "billing_prices" (
  "id" TEXT PRIMARY KEY,
  "plan_id" TEXT NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "provider" TEXT NOT NULL,
  "provider_product_id" TEXT NOT NULL,
  "provider_price_id" TEXT NOT NULL,
  "billing_period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_prices_provider_price_key" ON "billing_prices"("provider", "provider_price_id");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_prices_plan_provider_period_key" ON "billing_prices"("plan_id", "provider", "billing_period");
CREATE INDEX IF NOT EXISTS "billing_prices_provider_product_idx" ON "billing_prices"("provider", "provider_product_id");

CREATE TABLE IF NOT EXISTS "organization_job_attempts" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "job_id" TEXT NOT NULL REFERENCES "organization_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "attempt" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "result_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_job_attempts_job_attempt_key" ON "organization_job_attempts"("job_id", "attempt");
CREATE INDEX IF NOT EXISTS "organization_job_attempts_org_status_idx" ON "organization_job_attempts"("organization_id", "status", "started_at");

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "metric_key" TEXT NOT NULL,
  "period_key" TEXT NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_org_idempotency_key" ON "usage_events"("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "usage_events_org_metric_period_idx" ON "usage_events"("organization_id", "metric_key", "period_key");

CREATE TABLE IF NOT EXISTS "platform_administrator_events" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "platform_admin_events_user_created_idx" ON "platform_administrator_events"("user_id", "createdAt");

CREATE TABLE IF NOT EXISTS "organization_task_leases" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "task_key" TEXT NOT NULL,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "last_started_at" TIMESTAMP(3),
  "last_succeeded_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_task_leases_org_task_key" ON "organization_task_leases"("organization_id", "task_key");
CREATE INDEX IF NOT EXISTS "organization_task_leases_task_expiry_idx" ON "organization_task_leases"("task_key", "lease_expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_customer_key" ON "subscriptions"("provider", "provider_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_subscription_key" ON "subscriptions"("provider", "provider_subscription_id");
