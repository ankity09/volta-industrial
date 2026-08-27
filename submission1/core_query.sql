SELECT plant_id,
       COUNT(*) FILTER (WHERE risk_band IN ('critical','elevated')) AS atrisk_lines,
       COUNT(*) FILTER (WHERE risk_band = 'critical')               AS critical_lines,
       ROUND(SUM(downtime_exposure_usd))                            AS downtime_exposure_usd
FROM app.line_status
GROUP BY plant_id
ORDER BY downtime_exposure_usd DESC;
