-- Vibration trend: the wear story.
-- Weekly AVG(vibration_rms) on the affected (at-risk) lines vs the rest of the
-- fleet, last ~8 weeks, from silver_telemetry joined to the current risk band
-- in gold_line_status. The affected lines' vibration ramps ~3 weeks ago while
-- the rest of the fleet stays flat.
--
-- Tables are referenced via IDENTIFIER(:catalog || '.' || :schema || '.table')
-- and :catalog/:schema are bound at runtime (see server/routes/charts.ts) so
-- the same SQL resolves on any workspace. The @param samples below are used
-- only for DESCRIBE-time type generation.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = volta_industrial
WITH line_band AS (
  SELECT line_id, risk_band
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_line_status')
),
telemetry AS (
  SELECT
    t.telemetry_date,
    CASE WHEN b.risk_band IN ('critical', 'elevated', 'watch')
         THEN 'affected' ELSE 'fleet' END AS cohort,
    t.vibration_rms
  FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_telemetry') t
  LEFT JOIN line_band b ON t.line_id = b.line_id
  WHERE t.telemetry_date >= date_sub(current_date(), 56)
)
SELECT
  date_trunc('week', telemetry_date) AS week,
  CAST(ROUND(AVG(CASE WHEN cohort = 'affected' THEN vibration_rms END), 3) AS DOUBLE)
    AS affected_vibration_rms,
  CAST(ROUND(AVG(CASE WHEN cohort = 'fleet' THEN vibration_rms END), 3) AS DOUBLE)
    AS fleet_vibration_rms
FROM telemetry
GROUP BY date_trunc('week', telemetry_date)
ORDER BY week
