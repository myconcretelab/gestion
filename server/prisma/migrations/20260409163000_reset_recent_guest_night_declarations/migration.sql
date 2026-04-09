WITH target_periods AS (
    SELECT
        CAST(strftime('%Y', date('now', 'start of month', '-1 month')) AS INTEGER) AS year,
        CAST(strftime('%m', date('now', 'start of month', '-1 month')) AS INTEGER) AS month
    UNION ALL
    SELECT
        CAST(strftime('%Y', date('now', 'start of month', '-2 month')) AS INTEGER) AS year,
        CAST(strftime('%m', date('now', 'start of month', '-2 month')) AS INTEGER) AS month
    UNION ALL
    SELECT
        CAST(strftime('%Y', date('now', 'start of month', '-3 month')) AS INTEGER) AS year,
        CAST(strftime('%m', date('now', 'start of month', '-3 month')) AS INTEGER) AS month
)
DELETE FROM "guest_night_declarations"
WHERE EXISTS (
    SELECT 1
    FROM target_periods
    WHERE target_periods.year = "guest_night_declarations"."year"
      AND target_periods.month = "guest_night_declarations"."month"
);
