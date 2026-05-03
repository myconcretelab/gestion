ALTER TABLE "contrats" ADD COLUMN "signed_document_path" TEXT;
ALTER TABLE "contrats" ADD COLUMN "signed_document_filename" TEXT;
ALTER TABLE "contrats" ADD COLUMN "signed_document_mime_type" TEXT;
ALTER TABLE "contrats" ADD COLUMN "signed_document_size" INTEGER;
ALTER TABLE "contrats" ADD COLUMN "signed_document_uploaded_at" TIMESTAMP(3);
