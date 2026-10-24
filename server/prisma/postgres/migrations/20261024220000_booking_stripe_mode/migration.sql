-- Existing bookings and links were sandbox-only before explicit mode selection.
ALTER TABLE "booking_payments" ADD COLUMN "stripe_mode" TEXT NOT NULL DEFAULT 'test';
ALTER TABLE "reservation_payment_links" ADD COLUMN "stripe_mode" TEXT NOT NULL DEFAULT 'test';
