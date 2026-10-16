-- No backfill: issued/legacy invoices and their PDF archives stay unchanged.
ALTER TABLE "factures" ADD COLUMN "fiscal_data" TEXT;
