# Volta operational schema (Lakebase app.*, dev branch)

Related tables + keys (not a flat dump), with a searchable text field:

- line_status(id PK, line_id, plant_id, machine_type, failure_risk_score, downtime_exposure_usd,
  risk_band, vibration_rms, temperature_c, part_local, ...) — synced read-only from gold_line_status
- open_atrisk(line_id PK, plant_id, failure_risk_score, part_local, candidate_part_id, part_lead_time_days)
  — synced read-only from gold_open_atrisk
- maintenance_recommendations(line_id PK, recommended_action, predicted_downtime_cost_usd,
  predicted_net_value_usd, action_ranking JSONB, scored_at) — synced read-only
- parts(id PK, part_id, part_name, machine_type, description [SEARCHABLE], part_local, lead_time_days,
  unit_cost_usd, local_stock_qty) — synced read-only; BM25-indexed for Lakebase Search
- work_orders_app(id PK, line_id FK->line_status, action_type, part_id FK->parts, drafted_wo,
  status, approved_by, audit_trail JSONB, created_at, decided_at) — WRITABLE app state (Build 2);
  reverse-synced to UC Delta (SCD2) via scripts/reverse_sync_cdf.sh

Relationships: work_orders_app.line_id -> line_status.line_id; open_atrisk.candidate_part_id -> parts.part_id;
maintenance_recommendations.line_id -> open_atrisk.line_id. Searchable text: parts.description.
