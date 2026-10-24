-- AlterTable
ALTER TABLE "booking_payments" ADD COLUMN     "payment_link_id" TEXT,
ADD COLUMN     "reservation_id" TEXT,
ALTER COLUMN "booking_request_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reservation_payment_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'org_historical_broceliande',
    "reservation_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "deposit_cents" INTEGER NOT NULL,
    "offline_received_cents" INTEGER NOT NULL DEFAULT 0,
    "terms_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_payment_links_code_key" ON "reservation_payment_links"("code");

-- CreateIndex
CREATE INDEX "reservation_payment_links_organization_id_reservation_id_st_idx" ON "reservation_payment_links"("organization_id", "reservation_id", "status");

-- AddForeignKey
ALTER TABLE "reservation_payment_links" ADD CONSTRAINT "reservation_payment_links_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "reservation_payment_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

