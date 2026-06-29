CREATE TABLE "planning_relay_periods" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "date_debut" TIMESTAMP(3) NOT NULL,
    "date_fin" TIMESTAMP(3) NOT NULL,
    "gite_ids" JSONB NOT NULL DEFAULT '[]',
    "show_timeline" BOOLEAN NOT NULL DEFAULT false,
    "show_comments" BOOLEAN NOT NULL DEFAULT false,
    "show_phones" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "share_nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_relay_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "planning_relay_periods_active_date_fin_idx"
ON "planning_relay_periods"("is_active", "date_fin");
