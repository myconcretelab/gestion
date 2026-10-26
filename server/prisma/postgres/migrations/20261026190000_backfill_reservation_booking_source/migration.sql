-- Separate historical booking origins from payment methods without changing
-- receipts, payment statuses or explicitly chosen booking origins.
UPDATE "reservations"
SET "booking_source" = CASE
  WHEN TRIM("source_paiement") IN ('Airbnb', 'Abritel', 'Gites de France', 'HomeExchange')
    THEN TRIM("source_paiement")
  ELSE 'Direct'
END
WHERE "booking_source" IS NULL OR TRIM("booking_source") = '';
