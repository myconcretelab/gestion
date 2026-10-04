CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "gestionnaire_id" TEXT,
    "can_write" BOOLEAN NOT NULL DEFAULT true,
    "can_view_amounts" BOOLEAN NOT NULL DEFAULT true,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_users_gestionnaire_id_key" ON "app_users"("gestionnaire_id");
CREATE INDEX "app_users_active_name_idx" ON "app_users"("is_active", "display_name");

ALTER TABLE "app_users" ADD CONSTRAINT "app_users_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "app_users" (
  "id", "display_name", "gestionnaire_id", "can_write", "can_view_amounts", "is_owner", "is_active", "createdAt", "updatedAt"
)
SELECT
  'user_' || md5(random()::text || clock_timestamp()::text || "id"),
  btrim("prenom" || ' ' || "nom"),
  "id",
  true,
  true,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "gestionnaires";
