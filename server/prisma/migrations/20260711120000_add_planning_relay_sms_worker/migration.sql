PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_planning_relay_periods" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "date_debut" DATETIME NOT NULL,
  "date_fin" DATETIME NOT NULL,
  "gite_ids" TEXT NOT NULL DEFAULT '[]',
  "show_timeline" BOOLEAN NOT NULL DEFAULT false,
  "show_comments" BOOLEAN NOT NULL DEFAULT false,
  "show_phones" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "share_nonce" TEXT NOT NULL,
  "public_code_hash" TEXT,
  "expires_at" DATETIME,
  "last_accessed_at" DATETIME,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
  "sms_recipient" TEXT,
  "sms_worker_id" TEXT,
  "sms_send_time" TEXT NOT NULL DEFAULT '18:00',
  "sms_send_day" TEXT NOT NULL DEFAULT 'previous_day',
  "sms_last_sent_for_date" TEXT,
  "sms_last_attempt_for_date" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "planning_relay_periods_sms_worker_id_fkey" FOREIGN KEY ("sms_worker_id") REFERENCES "planning_relay_workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_planning_relay_periods" (
  "id",
  "label",
  "date_debut",
  "date_fin",
  "gite_ids",
  "show_timeline",
  "show_comments",
  "show_phones",
  "is_active",
  "share_nonce",
  "public_code_hash",
  "expires_at",
  "last_accessed_at",
  "sms_enabled",
  "sms_recipient",
  "sms_send_time",
  "sms_send_day",
  "sms_last_sent_for_date",
  "sms_last_attempt_for_date",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "label",
  "date_debut",
  "date_fin",
  "gite_ids",
  "show_timeline",
  "show_comments",
  "show_phones",
  "is_active",
  "share_nonce",
  "public_code_hash",
  "expires_at",
  "last_accessed_at",
  "sms_enabled",
  "sms_recipient",
  "sms_send_time",
  "sms_send_day",
  "sms_last_sent_for_date",
  "sms_last_attempt_for_date",
  "createdAt",
  "updatedAt"
FROM "planning_relay_periods";

DROP TABLE "planning_relay_periods";
ALTER TABLE "new_planning_relay_periods" RENAME TO "planning_relay_periods";

CREATE UNIQUE INDEX "planning_relay_periods_public_code_hash_key" ON "planning_relay_periods"("public_code_hash");
CREATE INDEX "planning_relay_periods_active_date_fin_idx" ON "planning_relay_periods"("is_active", "date_fin");
CREATE INDEX "planning_relay_periods_sms_schedule_idx" ON "planning_relay_periods"("sms_enabled", "sms_send_time");
CREATE INDEX "planning_relay_periods_sms_worker_idx" ON "planning_relay_periods"("sms_worker_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
