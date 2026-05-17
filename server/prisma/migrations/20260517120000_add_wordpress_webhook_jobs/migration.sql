CREATE TABLE "wordpress_webhook_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gite_id" TEXT NOT NULL,
  "event" TEXT NOT NULL DEFAULT 'gite.photos.saved',
  "state" TEXT NOT NULL DEFAULT 'queued',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "run_after" DATETIME NOT NULL,
  "queued_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" DATETIME,
  "completed_at" DATETIME,
  "response_status" INTEGER,
  "response_body" TEXT,
  "last_error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "wordpress_webhook_jobs_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "wordpress_webhook_jobs_gite_id_key" ON "wordpress_webhook_jobs"("gite_id");
CREATE INDEX "wordpress_webhook_jobs_state_run_after_idx" ON "wordpress_webhook_jobs"("state", "run_after");
