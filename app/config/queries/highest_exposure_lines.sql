-- Highest downtime-exposure lines: the worst at-risk lines.
-- Top lines by downtime_exposure_usd from gold_line_status where the line is
-- critical or elevated. LINE-04 should sit near the top.
--
-- Tables referenced via IDENTIFIER(:catalog || '.' || :schema || '.table');
-- :catalog/:schema are bound at runtime. @param samples are for typegen only.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = volta_industrial
SELECT
  line_id,
  plant_id,
  machine_type,
  CAST(ROUND(vibration_rms, 3) AS DOUBLE) AS vibration_rms,
  CAST(ROUND(failure_risk_score, 3) AS DOUBLE) AS failure_risk_score,
  CAST(ROUND(downtime_exposure_usd, 2) AS DOUBLE) AS downtime_exposure_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_line_status')
WHERE risk_band IN ('critical', 'elevated')
ORDER BY downtime_exposure_usd DESC
LIMIT 20
