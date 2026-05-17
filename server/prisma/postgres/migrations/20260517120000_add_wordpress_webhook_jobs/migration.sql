CREATE TABLE "wordpress_webhook_jobs" (
  "id" TEXT NOT NULL,
  "gite_id" TEXT NOT NULL,
  "event" TEXT NOT NULL DEFAULT 'gite.photos.saved',
  "state" TEXT NOT NULL DEFAULT 'queued',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "run_after" TIMESTAMP(3) NOT NULL,
  "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "response_status" INTEGER,
  "response_body" TEXT,
  "last_error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wordpress_webhook_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wordpress_webhook_jobs_gite_id_key" ON "wordpress_webhook_jobs"("gite_id");
CREATE INDEX "wordpress_webhook_jobs_state_run_after_idx" ON "wordpress_webhook_jobs"("state", "run_after");
ALTER TABLE "wordpress_webhook_jobs" ADD CONSTRAINT "wordpress_webhook_jobs_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
