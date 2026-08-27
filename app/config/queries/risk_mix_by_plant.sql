-- Risk mix by plant: which plants carry the risk.
-- Line count by plant_id x risk_band from gold_line_status. Feeds a grouped bar
-- so the affected cluster's concentration across the 8 plants is legible.
--
-- Tables referenced via IDENTIFIER(:catalog || '.' || :schema || '.table');
-- :catalog/:schema are bound at runtime. @param samples are for typegen only.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = volta_industrial
SELECT
  plant_id,
  risk_band,
  CAST(COUNT(*) AS BIGINT) AS line_count
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_line_status')
GROUP BY plant_id, risk_band
ORDER BY plant_id, risk_band
