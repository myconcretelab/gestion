UPDATE "reservations"
SET
  "origin_system" = 'ical',
  "export_to_ical" = 0
WHERE
  "origin_system" = 'app'
  AND upper(trim(COALESCE("commentaire", ''))) IN ('RESERVED', 'BOOKED', 'AIRBNB (NOT AVAILABLE)');
