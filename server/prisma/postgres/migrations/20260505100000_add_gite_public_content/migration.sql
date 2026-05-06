ALTER TABLE "gites" ADD COLUMN "public_slug" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_title" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_summary" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_description" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_seo_title" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_seo_description" TEXT;
ALTER TABLE "gites" ADD COLUMN "public_is_published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "gites" ADD COLUMN "public_structured_content" JSONB;
ALTER TABLE "gites" ADD COLUMN "public_equipment" JSONB;
ALTER TABLE "gites" ADD COLUMN "public_rooms" JSONB;
ALTER TABLE "gites" ADD COLUMN "public_practical_info" JSONB;
ALTER TABLE "gites" ADD COLUMN "public_location_info" JSONB;
ALTER TABLE "gites" ADD COLUMN "public_latitude" DECIMAL(9,6);
ALTER TABLE "gites" ADD COLUMN "public_longitude" DECIMAL(9,6);

CREATE TABLE "gite_photos" (
  "id" TEXT NOT NULL,
  "gite_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "alt" TEXT,
  "credit" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_public" BOOLEAN NOT NULL DEFAULT true,
  "ordre" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gite_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gites_public_slug_key" ON "gites"("public_slug");
CREATE INDEX "gites_public_published_ordre_idx" ON "gites"("public_is_published", "ordre");
CREATE INDEX "gite_photos_gite_ordre_idx" ON "gite_photos"("gite_id", "ordre");
CREATE INDEX "gite_photos_public_ordre_idx" ON "gite_photos"("gite_id", "is_public", "ordre");
ALTER TABLE "gite_photos" ADD CONSTRAINT "gite_photos_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
