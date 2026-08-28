-- Build 2 · VISUALIZE — the live plant-floor at-risk queue.
--
-- This is the query behind the app's Operations "Work the at-risk lines" view
-- (server/db/queries/maintenance.ts → listLines). It reads the live, writable
-- Lakebase schema `app` (line_status is the Build-1 synced UC table, mirrored
-- into Postgres read-only; open_atrisk + parts add the candidate-part context).
--
-- TRIGGER: this view is refreshed by a SYSTEM event, not a human opening it —
-- the app subscribes to `dataMutated` and re-runs this query whenever the agent
-- commits a work order (execute_maintenance_action), so the ranked queue and
-- KPIs update live the moment a decision lands (closed loop).
--
-- RANKING: ordered by downtime_exposure_usd DESC and filtered to the critical
-- band so the highest-value at-risk line is always on top.
SELECT
  ls.line_id,
  ls.line_name,
  ls.plant_id,
  ls.machine_type,
  ls.vibration_rms,
  ls.temperature_c,
  ls.utilization_pct,
  ls.failure_risk_score,
  ls.open_wo_count,
  ls.has_open_corrective,
  ls.risk_signal_score,
  ls.part_local,
  ls.downtime_exposure_usd,
  ls.risk_band,
  oa.candidate_part_id,
  p.part_name,
  p.lead_time_days AS part_lead_time_days
FROM app.line_status ls
LEFT JOIN app.open_atrisk oa ON oa.line_id = ls.line_id
LEFT JOIN app.parts p ON p.part_id = oa.candidate_part_id
WHERE ls.risk_band = 'critical'
ORDER BY ls.downtime_exposure_usd DESC;
