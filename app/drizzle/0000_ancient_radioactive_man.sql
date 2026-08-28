-- Baseline migration. All objects (schema app, chat tables, synced mirror
-- tables, work_orders_app) already exist in the team's canonical Lakebase
-- (Brian's volta/development db). The synced tables (line_status etc.) are
-- managed Synced Tables the app cannot run DDL against, so this migration is
-- intentionally a no-op: it only records the journal entry so Drizzle's
-- migrator is satisfied on boot.
SELECT 1;
