#!/usr/bin/env bash
# Generate Build 2 (submission2) evidence exports from the LIVE Lakebase dev branch.
# Run after at least one maintenance decision has been approved in the app
# (or after the seed step below inserts a representative closed-loop work order).
#
# Produces into submission2/:
#   writeback_table.json  - app.work_orders_app (proposed action, approval, approver, timestamps)
#   state_table.json      - workflow-state / observability (audit trail + trigger events)
#   view_query.sql        - the live-view query (already written)
#   view_result.json      - the ranked at-risk rows (already captured; refreshed here)
#   (assist_log.jsonl, drafted_sample.md, hero_question.txt come from the app runtime + are already staged)
set -euo pipefail

PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-sandbox-predictive-maintainers}"
EP="projects/volta/branches/dev/endpoints/primary"
HOST="ep-steep-brook-d82sqg6v.database.us-east-2.cloud.databricks.com"
PGUSER="ankit.yadav@databricks.com"
SUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/submission2"
mkdir -p "$SUB"

TOKEN=$(databricks postgres generate-database-credential "$EP" --profile "$PROFILE" -o json \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
psql() { PGPASSWORD="$TOKEN" command psql "host=$HOST user=$PGUSER dbname=databricks_postgres sslmode=require" "$@"; }

echo "[evidence] writeback_table.json"
psql -f - > "$SUB/writeback_table.json" <<'SQL'
COPY (SELECT json_agg(row_to_json(t)) FROM (
  SELECT id, line_id, action_type, part_id, drafted_wo, predicted_downtime_cost_avoided_usd,
         status, approved_by, created_at, decided_at
  FROM app.work_orders_app ORDER BY created_at DESC
) t) TO STDOUT;
SQL

echo "[evidence] state_table.json (workflow state + observability: audit trail + decisions)"
psql -f - > "$SUB/state_table.json" <<'SQL'
COPY (SELECT json_agg(row_to_json(t)) FROM (
  SELECT w.id AS work_order_id, w.line_id, w.status, w.action_type,
         a.value ->> 'at'     AS event_time,
         a.value ->> 'by'     AS actor,
         a.value ->> 'action' AS event,
         a.value ->> 'notes'  AS notes,
         a.value ->> 'tool'   AS tool
  FROM app.work_orders_app w
  CROSS JOIN LATERAL jsonb_array_elements(w.audit_trail) AS a(value)
  ORDER BY (a.value ->> 'at')
) t) TO STDOUT;
SQL

echo "[evidence] view_result.json (refresh the ranked live view)"
psql -f - > "$SUB/view_result.json" <<SQL
COPY (SELECT json_agg(row_to_json(t)) FROM (
$(sed 's/;$//' "$SUB/view_query.sql")
) t) TO STDOUT;
SQL

echo "[evidence] done. Files in $SUB:"
ls -1 "$SUB"
