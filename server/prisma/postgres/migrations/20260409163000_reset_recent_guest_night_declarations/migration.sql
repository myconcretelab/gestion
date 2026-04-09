WITH target_periods AS (
    SELECT
        EXTRACT(YEAR FROM (date_trunc('month', CURRENT_DATE) - (INTERVAL '1 month' * offset_value)))::INTEGER AS year,
        EXTRACT(MONTH FROM (date_trunc('month', CURRENT_DATE) - (INTERVAL '1 month' * offset_value)))::INTEGER AS month
    FROM generate_series(1, 3) AS offset_value
)
DELETE FROM "guest_night_declarations" AS declaration
USING target_periods
WHERE declaration."year" = target_periods.year
  AND declaration."month" = target_periods.month;
