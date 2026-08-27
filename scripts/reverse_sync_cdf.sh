#!/usr/bin/env bash
# Reverse Lakehouse Sync (Build 1, requirement 2): stream writable-Postgres
# changes back into Unity Catalog Delta tables as SCD Type 2 history, defined
# as code (this script), not UI-only.
#
# The CDF config materializes the change data feed of EVERY table in the
# `app` Postgres schema (notably the writable work_orders_app) as open-format
# Delta tables in UC, with append-only system metadata columns + full history.
#
# Prereqs (satisfied by the app deploy in Phase 2):
#   - work_orders_app exists on the dev branch (created by the app's Drizzle migration)
#   - a NON-default-storage UC catalog for the CDF destination (default-storage
#     catalogs are rejected by CDF; the team pattern is a MANAGED external-storage
#     catalog, e.g. nimbus_reverse_sync / cedar_cdf).
#
# Run:  ./scripts/reverse_sync_cdf.sh
set -euo pipefail

PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-sandbox-predictive-maintainers}"
PROJECT="volta"
BRANCH="dev"
PG_DATABASE="databricks_postgres"
PG_SCHEMA="app"

# Destination UC catalog/schema for the reverse-synced Delta tables (SCD2).
# predictive_maintainers_catalog is external-storage backed
# (s3://predictive-maintainers-ext-s3-...), so CDF accepts it (default-storage
# catalogs are rejected). Reverse-synced history lands in a dedicated schema.
DEST_CATALOG="${VOLTA_CDF_CATALOG:-predictive_maintainers_catalog}"
DEST_SCHEMA="${VOLTA_CDF_SCHEMA:-volta_cdf}"
CDF_ID="volta-app-cdf"

PARENT="projects/${PROJECT}/branches/${BRANCH}/databases/${PG_DATABASE}"

echo "[reverse-sync] Creating CDF config:"
echo "  from Postgres:  ${PARENT} schema=${PG_SCHEMA}"
echo "  to UC Delta:    ${DEST_CATALOG}.${DEST_SCHEMA} (SCD Type 2 + system metadata cols)"

databricks postgres create-cdf-config \
  "${PARENT}" "${DEST_CATALOG}" "${DEST_SCHEMA}" "${PG_SCHEMA}" \
  --cdf-config-id "${CDF_ID}" \
  --profile "${PROFILE}"

echo "[reverse-sync] Status:"
databricks postgres get-cdf-status "${PARENT}/cdfConfigs/${CDF_ID}" --profile "${PROFILE}" || true

echo "[reverse-sync] Done. The writable work_orders_app changes now stream to"
echo "  ${DEST_CATALOG}.${DEST_SCHEMA}.work_orders_app as SCD Type 2 Delta history."
