UPDATE "reservations"
SET
  "origin_system" = 'ical',
  "export_to_ical" = false
WHERE
  "origin_system" = 'app'
  AND upper(trim(COALESCE("commentaire", ''))) IN ('RESERVED', 'BOOKED', 'AIRBNB (NOT AVAILABLE)');
