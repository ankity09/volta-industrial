-- Volta Plant Floor live view (Build 2 "Visualize"): the at-risk queue,
-- ranked so the important thing is obvious. Reads the synced read-only
-- app.line_status + open_atrisk, LEFT JOIN the writable app.work_orders_app
-- so a line with an approved action is shown as "action taken" (closed loop).
SELECT
  ls.line_id,
  ls.plant_id,
  ls.machine_type,
  ls.risk_band,
  ROUND(ls.failure_risk_score::numeric, 2) AS failure_risk_score,
  ROUND(ls.vibration_rms::numeric, 2)      AS vibration_rms,
  ls.open_wo_count,
  oa.part_local,
  ROUND(ls.downtime_exposure_usd::numeric)  AS downtime_exposure_usd,
  wo.status                                  AS action_status,
  wo.action_type                             AS action_taken
FROM app.line_status ls
LEFT JOIN app.open_atrisk oa USING (line_id)
LEFT JOIN LATERAL (
  SELECT status, action_type FROM app.work_orders_app w
  WHERE w.line_id = ls.line_id ORDER BY w.created_at DESC LIMIT 1
) wo ON true
WHERE ls.risk_band IN ('critical','elevated','watch')
ORDER BY
  CASE ls.risk_band WHEN 'critical' THEN 0 WHEN 'elevated' THEN 1 ELSE 2 END,
  ls.downtime_exposure_usd DESC;
