-- Worst maintenance outcomes: the maintenance calls that went worst, ranked by
-- net loss = action_cost_usd - downtime_cost_avoided_usd (money spent that
-- averted little or no unplanned downtime). The top rows are typically
-- run_to_shift_end calls where avoided_unplanned_stop is false, so the full
-- action cost is pure loss. Real data from gold_maintenance_outcomes.
--
-- Tables referenced via IDENTIFIER(:catalog || '.' || :schema || '.table');
-- :catalog/:schema are bound at runtime. @param samples are for typegen only.
-- @param catalog STRING = predictive_maintainers_catalog
-- @param schema STRING = volta
SELECT
  event_id,
  line_id,
  action_type,
  criticality,
  CAST(ROUND(risk_at_action, 3) AS DOUBLE) AS risk_at_action,
  CAST(ROUND(downtime_hours, 1) AS DOUBLE) AS downtime_hours,
  CAST(ROUND(action_cost_usd, 2) AS DOUBLE) AS action_cost_usd,
  CAST(ROUND(downtime_cost_avoided_usd, 2) AS DOUBLE) AS downtime_cost_avoided_usd,
  CAST(ROUND(action_cost_usd - downtime_cost_avoided_usd, 2) AS DOUBLE) AS net_loss_usd,
  avoided_unplanned_stop
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_maintenance_outcomes')
ORDER BY net_loss_usd DESC
LIMIT 20
