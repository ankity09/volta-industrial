# Volta Industrial TKO — Handoff for the next Isaac session

You are picking up a Databricks "AI Customer Challenge" (TKO) build for **Volta Industrial**, a
plant-floor predictive-maintenance decision app. Three graded builds. A teammate (Ankit) + Brian +
Vinod are working this together; resources are shared. Read this whole doc before acting.

## READ FIRST — the challenge requirements page
All build/submission requirements live here (open it, read the "challenge" tab):
**https://skills-navigator-3167433485162412.aws.databricksapps.com/events-hub?tab=challenge**
It is a Databricks App (SSO-gated). Use it as the source of truth for what each build must contain
and the exact evidence each submission zip needs. Everything below maps to it.

## Workspace + identity
- Workspace: `fe-sandbox-predictive-maintainers` (profile `fe-sandbox-predictive-maintainers`, o=7474647707959925)
- Warehouse: `cbe5f41d6e94bb63`
- Governed UC catalog (Delta source): `predictive_maintainers_catalog.volta.*` (gold_line_status 1200, gold_open_atrisk 155, gold_maintenance_recommendations 155, note_risk_flags, silver_*). External-storage backed (S3), so it can host CDF reverse-sync targets.

## The three builds + current status

### Build 1 — Lakebase (DONE, ~90%)
- Team's canonical Lakebase: Autoscaling project **`projects/volta`**, branches **`production`** (demo) + **`development`** (build). Owner brian.leach. Use `databricks postgres` CLI (NOT `databricks database`).
- **dev branch** endpoint host `ep-silent-meadow-d8pjy4fh.database.us-east-2.cloud.databricks.com`, logical **db `volta`** (resource id `db-yjsp-gu57qcizor`), schema **`app`**.
- Tables live + populated in `app`: line_status (1200, a managed **Synced Table** — read-only, rejects DDL), open_atrisk (155), maintenance_recommendations (155), parts (800, hybrid-search indexed: idx_parts_ann + idx_parts_bm25), work_orders_app (WRITABLE, bigint identity id, status proposed/approved/executed/overridden), plus chat tables conversations/messages/feedback.
- Lakebase Search: pgvector + lakebase_text extensions enabled; BM25 + ANN indexes on parts.
- To connect as yourself: create a Postgres role once (`databricks postgres create-role projects/volta/branches/development --role-id <you-hyphenated> --json '{"spec":{"identity_type":"USER","postgres_role":"<you@databricks.com>","auth_method":"LAKEBASE_OAUTH_V1","membership_roles":["DATABRICKS_SUPERUSER"]}}'`), then mint a token with `generate-database-credential <endpoint>` and `PGPASSWORD=$TOKEN psql "host=<host> user=<you@databricks.com> dbname=volta sslmode=require"`.
- submission1 evidence (6 files) is in `submission1/` (connectivity, search_query+result, core_question+query+result, branch.txt, DATA_MODEL.md). MISSING: reverse_sync_sample.json (SCD2) — that is Brian's Lakehouse-sync workstream; his DAB job `volta_reverse_sync` writes to `predictive_maintainers_catalog.dev_brian_leach_volta.work_orders_history`. Coordinate with Brian.

### Build 2 — Databricks App (DEPLOYED + RUNNING; data layer VERIFIED working — remaining: 3D canvas + chat)
- **LIVE URL: https://volta-plant-floor-7474647707959925.aws.databricksapps.com** — app RUNNING, boots clean (Migrations up to date, Delta sync done, MLflow active). SP client id `8add3b16-2eed-453a-8927-6cad582e6f1a`.
- **VERIFIED IN BROWSER (post routes-fix deploy):** Operations view now loads live data — at-risk table shows 90 critical lines incl. LINE-0004, KPIs read Downtime Exposure $3.5M / Open WOs 94 / Critical 90. /api/lines, /api/lines/summary, /api/activity/recent all 200. 0 console errors. So Build 2's "Visualize" data path works; the 3D scene + chat are the two remaining gaps.
- Stack: AppKit (Node/Express + React + Drizzle ORM), 3D plant floor (Three.js) merged from the PCC digital twin. Local repo `~/Desktop/Databricks/volta-industrial`, branch **`build/volta-app`** (pushed to github.com/ankity09/volta-industrial). App under `app/`.
- Resources bound to the app: `sql-warehouse` (warehouse id) + `postgres` (Brian's volta/development db).
- **Browser test (chrome devtools) findings — the punch list:**
  1. **[FIXED — commit 4054bf6, redeployed]** 404s on core data endpoints. All 8 were missing server routes; now implemented in `server/routes/lines.ts` (registerLinesRoutes, reuses maintenance.ts query helpers: listLines/linesSummary/plantMap/getLineDetail/recentActivity/searchPartsDetailed). `build:source` passes. Route order matters (/summary + /:id/recommendation before /:id). NOTE: `dataMutated` is client-side-only (no server emitter) — the work-order POST commits transactionally before responding, and the client's own dataMutated-on-turn-end refetch surfaces it. VERIFY in browser after this deploy that /api/lines returns rows and the at-risk table + KPIs populate. Some Part fields (machineType, localStockQty) are defaulted (no Lakebase column); candidate_part_id/part cost come via LEFT JOIN open_atrisk+parts.
  2. **3D canvas WebGL framebuffer errors** ("Attachment has zero size"). The PlantFloor3D component renders into a zero-size container. Likely a CSS/layout issue (canvas parent has 0 height) or the bloom EffectComposer sized before layout. RELATED build warning to fix first: `"LineStatus" is not exported by client/src/plantfloor/types.ts` (imported by PlantFloor3D.tsx + usePlantFloorScene.ts) — the local plantfloor/types.ts is missing/renamed the LineStatus export the 3D code imports. Reconcile that type export, then fix the container sizing so the WebGL canvas has non-zero dimensions. Data now loads (see #1) so the scene has real lines to render.
  3. **Chat assistant hangs on "Loading"** — POST to /api/chat/stream / conversation flow never completes. Once the LLM path is exercised, verify the Unity AI Gateway routing (see Build 3) is actually reachable from the container; a 4xx from the gateway would hang the stream. Check container logs during a chat turn.
- **/api/config, /api/me, /api/conversations = 200 OK** (auth + config + chat-state DB all work).
- submission2 evidence: 5–7 files staged in `submission2/` (writeback_table, state_table, view_query+result, drafted_sample, hero_question, git_history). The live ones (assist_log.jsonl + a real chat memo) need a WORKING chat turn — do after fix #3.

### Build 3 — Unity AI Gateway (DONE by Vinod — do not rebuild)
- Vinod owns it. The app just routes its LLM calls through his governed model service **`predictive_maintainers_catalog.vinod.volta_gateway`** via base URL `/ai-gateway/mlflow/v1` (already wired in `app/config/app.json` agentModel + `app/server/agent/plantfloor.ts` baseURL). Inference table, guardrail (blocks all-data reads), budget, rate limit 300 rpm, usage dashboard all exist on his side. submission3 is Vinod's.
- His full handoff (guardrails, request-tags header for per-line attribution, verify query) is in Ankit's Slack + the UNITY_AI_GATEWAY_HANDOFF.md he referenced.

## HARD-WON deploy gotchas (do NOT relearn these)
1. **Local npm install** on this Mac hangs on the Databricks proxy. FIX: `npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund` (the ~9GB `~/.npm` cache has everything; public registry is FIREWALLED here).
2. **Build tools must be in `dependencies`** (not devDependencies) — the Apps container prunes dev deps, so vite/esbuild/tailwind/tsdown/drizzle-kit live in `dependencies`. Server bundles via **esbuild** (tsdown had an offline rolldown version mismatch): `build:server` = `esbuild server/server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js`.
3. **zod pinned to 4.4.3** — `@openai/agents-core` needs zod v4; v3 crashes at module load ("Cannot read properties of undefined reading 'type'").
4. **`.npmrc`** in app/ sets `legacy-peer-deps=true` so the CONTAINER npm install resolves (appkit peer-wants vitest>=3).
5. **`.env` must NOT contain `DATABRICKS_CONFIG_PROFILE`** — it ships to the container and causes MLflow "more than one authorization method: oauth and pat". Export the profile in your shell for deploy.sh instead: `export DATABRICKS_CONFIG_PROFILE=fe-sandbox-predictive-maintainers && ./scripts/deploy.sh`.
6. **Drizzle migration is baselined to a no-op** (`drizzle/0000_*.sql` = `SELECT 1;`) because all tables pre-exist in Brian's db AND line_status is a managed Synced Table that rejects `CREATE TABLE` DDL. `build-app.sh` has `db:generate` DISABLED for the same reason. If you change schema.ts, you must handle migrations manually (do NOT let drizzle try to create line_status).
7. **App SP needs Postgres grants**: role `dbrx-apps-8add3b16...` exists on the development branch with SELECT/INSERT/UPDATE/DELETE on schema app + CREATE on db volta. If you see "permission denied for schema", re-grant as a superuser-connected psql session.
8. Deploy = `cd app && export DATABRICKS_CONFIG_PROFILE=... && ./scripts/deploy.sh` (build + upload + create + deploy). Takes several minutes; run backgrounded. If "not in RUNNING state", `databricks apps start volta-plant-floor` first, wait for compute ACTIVE, then deploy.

## Recommended next steps (in order)
1. Confirm the in-flight `server/routes/lines.ts` fix landed + builds; redeploy; re-test in browser that /api/lines returns data and the at-risk table + KPIs populate.
2. Fix the 3D canvas zero-size framebuffer (CSS/layout of the PlantFloor3D container).
3. Verify the chat assistant completes a turn through Vinod's gateway; fix routing/scope if it hangs.
4. Once the closed loop works in-browser (ask hero question -> rank pull_now -> approve -> KPI ticks), capture submission2 live evidence (assist_log.jsonl, drafted memo) and zip submission1/2/3.
5. Coordinate with Brian on the Build 1 reverse_sync_sample.json evidence.

## Architecture diagram (Lucidchart, clean version)
https://lucid.app/lucidchart/0246023d-6f25-46d6-a02a-ed6f94144cc3/edit

## Key files
- `app/server/routes/` (add lines.ts here), `app/server/db/queries/maintenance.ts` (query helpers), `app/server/db/schema.ts` (Drizzle, matches Brian's tables), `app/client/src/lib/lines.ts` (client endpoint contracts), `app/client/src/plantfloor/PlantFloor3D.tsx` (3D), `app/config/app.json` (agentModel = gateway), `app/scripts/deploy.sh`, `app/.env` (local only).
- Style: no em dashes; serverless only; keep it looking like a premium Fortune-500 product.
