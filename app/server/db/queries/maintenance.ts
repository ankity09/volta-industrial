/**
 * Lakebase query helpers for the Volta plant-floor agent.
 *
 * These back the agent's four data tools in server/agent/plantfloor.ts:
 *   worstAtriskLine / getAtriskLine / getLineStatus  → find_atrisk_line
 *   getRecommendation                                → rank_maintenance_actions
 *   searchParts                                      → search_parts (Lakebase Search)
 *   recordMaintenanceAction                          → execute_maintenance_action (WRITE)
 *
 * Everything here reads the `app.*` Lakebase tables that db/sync.ts mirrors
 * from Delta. The only WRITE is recordMaintenanceAction, which inserts a row
 * into app.work_orders_app (the app's single writable table) inside a
 * transaction and stamps the OBO user's identity as approved_by.
 */
import { desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  lineStatus,
  openAtrisk,
  maintenanceRecommendations,
  parts,
  workOrdersApp,
  type MaintenanceActionOption,
  type MaintenanceAuditEntry,
} from '../schema.js';

/** One at-risk line row (from app.open_atrisk). */
export type AtriskLine = typeof openAtrisk.$inferSelect;
/** One line-status row (from app.line_status). */
export type LineStatus = typeof lineStatus.$inferSelect;

/**
 * The worst open at-risk line by downtime exposure. Powers
 * find_atrisk_line when the caller passes no line_id (the "worst open" case).
 * Reads app.open_atrisk ordered by downtime_exposure_usd DESC.
 */
export async function worstAtriskLine(db: AppDb): Promise<AtriskLine | null> {
  const rows = await db
    .select()
    .from(openAtrisk)
    .orderBy(desc(openAtrisk.downtimeExposureUsd))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The at-risk row for a specific line (parts context: part_local,
 * candidate_part_id, part_lead_time_days). Returns null if the line is not
 * currently in the at-risk cohort.
 */
export async function getAtriskLine(
  db: AppDb,
  lineId: string,
): Promise<AtriskLine | null> {
  const rows = await db
    .select()
    .from(openAtrisk)
    .where(eq(openAtrisk.lineId, lineId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Current status for a line from app.line_status (telemetry + risk + band).
 * find_atrisk_line combines this with the at-risk parts context.
 */
export async function getLineStatus(
  db: AppDb,
  lineId: string,
): Promise<LineStatus | null> {
  const rows = await db
    .select()
    .from(lineStatus)
    .where(eq(lineStatus.lineId, lineId))
    .limit(1);
  return rows[0] ?? null;
}

/** The ranked-action recommendation for a line (the "ML in the loop" read). */
export type Recommendation = {
  lineId: string;
  recommendedAction: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
  predictedDowntimeCostUsd: number | null;
  actionRanking: MaintenanceActionOption[];
  scoredAt: Date | null;
};

/**
 * The model's ranked actions for a line from app.maintenance_recommendations
 * (mirrored from gold_maintenance_recommendations). Returns null when the
 * recommendations table has not been populated yet, so the tool can explain
 * the gap instead of throwing.
 */
export async function getRecommendation(
  db: AppDb,
  lineId: string,
): Promise<Recommendation | null> {
  const rows = await db
    .select()
    .from(maintenanceRecommendations)
    .where(eq(maintenanceRecommendations.lineId, lineId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    lineId: r.lineId,
    recommendedAction: r.recommendedAction,
    predictedDowntimeCostUsd: r.predictedDowntimeCostUsd ?? null,
    actionRanking: r.actionRanking ?? [],
    scoredAt: r.scoredAt ?? null,
  };
}

/** One candidate part returned by searchParts. */
export type PartMatch = {
  part_id: string;
  part_name: string;
  part_category: string;
  part_local: boolean;
  lead_time_days: number | null;
};

/**
 * Part search over app.parts, powering the expedite-parts play. This is the
 * Lakebase Search surface: a hybrid full-text + vector match over the parts
 * catalog's (part_name, description) fields, ranked by relevance.
 *
 * Implementation note: Lakebase Search's vector index over (part_name,
 * description) is provisioned in the data layer (Milestone 2 Lakebase setup,
 * see 03_DATA_MODEL.md). Until that index exists we run Postgres full-text
 * search (websearch_to_tsquery over part_name + description) with an ILIKE
 * fallback so a query still returns candidates with no ML dependency.
 * TODO(data-layer): when the vector index lands, add a similarity() clause and
 * blend it with ts_rank for true hybrid ranking.
 */
export async function searchParts(
  db: AppDb,
  query: string,
): Promise<PartMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const result = await db.execute(sql`
    SELECT
      part_id,
      part_name,
      part_category,
      part_local,
      lead_time_days,
      ts_rank(
        to_tsvector('english', coalesce(part_name, '') || ' ' || coalesce(description, '')),
        websearch_to_tsquery('english', ${q})
      ) AS rank
    FROM app.parts
    WHERE
      to_tsvector('english', coalesce(part_name, '') || ' ' || coalesce(description, ''))
        @@ websearch_to_tsquery('english', ${q})
      OR part_name ILIKE ${like}
      OR description ILIKE ${like}
    ORDER BY rank DESC NULLS LAST, part_name ASC
    LIMIT 10
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    part_id: String(r.part_id ?? ''),
    part_name: String(r.part_name ?? ''),
    part_category: r.part_category == null ? '' : String(r.part_category),
    part_local: Boolean(r.part_local),
    lead_time_days: r.lead_time_days == null ? null : Number(r.lead_time_days),
  }));
}

/**
 * WRITE: record an approved maintenance action to app.work_orders_app, the
 * only table the app writes. Filter-driven (a line + the drafted work order,
 * never a list of ids) and transactional.
 *
 * The three-phase chain drafts the work order in the conversation (not the
 * DB); this call is Phase 3, invoked only after the human approves, so the
 * row lands directly as status='approved' with an append-only audit entry
 * stamped with the OBO user's email. (The status enum is
 * drafted|approved|rejected; there is no separate 'proposed' state. The
 * proposal lives in the chat, the approval lands here.)
 *
 * The row committing inside this transaction, before the chat turn ends, is
 * what makes the client's turn-end `dataMutated` refetch surface the write:
 * the Plant Floor KPI ticks down, the line flips to "action taken", and the
 * work order appears in the drawer timeline, with no reload.
 */
export async function recordMaintenanceAction(
  db: AppDb,
  args: {
    lineId: string;
    actionType: 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
    partId: string | null;
    draftedWorkOrder: string;
    predictedDowntimeCostAvoidsUsd: number | null;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  const auditTrail: MaintenanceAuditEntry[] = [
    {
      at: new Date().toISOString(),
      by: args.userEmail,
      action: 'approved',
      notes: 'Maintenance action recorded',
      tool: 'execute_maintenance_action',
    },
  ];

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(workOrdersApp)
      .values({
        lineId: args.lineId,
        actionType: args.actionType,
        partId: args.partId,
        draftedWo: args.draftedWorkOrder,
        predictedDowntimeCostAvoidsUsd: args.predictedDowntimeCostAvoidsUsd,
        status: 'approved',
        approvedBy: args.userEmail,
        auditTrail,
        decidedAt: new Date(),
      })
      .returning({ id: workOrdersApp.id });
    return { actionId: rows[0].id };
  });
}

// ============================================================================
// REST route query helpers (lines / plants / parts / activity).
//
// These back server/routes/lines.ts — the plant-floor REST surface the client
// (client/src/lib/lines.ts) calls. They return the exact camelCase / snake_case
// shapes declared in client/src/shared/types.ts. The server does NOT import the
// client types (that file is hand-copied on purpose, see its header note), so
// the response shapes are re-declared here and kept structurally in sync.
//
// Why raw parameterized SQL for line reads instead of the Drizzle `lineStatus`
// table object: the live Lakebase `app.line_status` synced table carries
// telemetry + queue columns (machine_type, criticality, plant_lat, plant_lng,
// vibration_rms, temperature_c, utilization_pct, open_wo_count,
// has_open_corrective, risk_signal_score, part_local, risk_band) that the
// Drizzle schema object does not model. A typed `db.select().from(lineStatus)`
// would silently drop them, so we read the columns explicitly. The parts
// context the client wants ON a line (candidate_part_id, part_unit_cost_usd,
// part_lead_time_days) is not on line_status at all — it lives in
// app.open_atrisk + app.parts — so we LEFT JOIN both and leave those fields
// null for lines that are not currently in the at-risk cohort. Same pattern
// (db.execute + sql``) already used by searchParts above; all interpolated
// values are bound as parameters, never string-concatenated.
// ============================================================================

export type ActionTypeValue =
  | 'pull_now'
  | 'run_to_shift_end'
  | 'expedite_parts_and_run';
export type RiskBandValue = 'critical' | 'elevated' | 'watch' | 'healthy';
export type WorkOrderStatusValue =
  | 'proposed'
  | 'approved'
  | 'executed'
  | 'overridden';

/** Matches client `LineStatus` (camelCase). */
export type LineStatusApi = {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: string;
  criticality: string;
  plantLat: number;
  plantLng: number;
  vibrationRms: number;
  temperatureC: number;
  utilizationPct: number;
  failureRiskScore: number;
  openWoCount: number;
  hasOpenCorrective: boolean;
  candidatePartId: string | null;
  partLocal: boolean;
  partUnitCostUsd: number | null;
  partLeadTimeDays: number | null;
  riskSignalScore: number | null;
  downtimeExposureUsd: number;
  riskBand: RiskBandValue;
};

/** Matches client `AuditEntry`. */
export type AuditEntryApi = {
  at: string;
  by: string;
  action: string;
  notes?: string;
};

/** Matches client `WorkOrderApp` (camelCase). */
export type WorkOrderAppApi = {
  id: string;
  lineId: string;
  actionType: ActionTypeValue;
  partId: string | null;
  draftedWo: string;
  predictedDowntimeCostAvoidedUsd: number;
  status: WorkOrderStatusValue;
  approvedBy: string | null;
  auditTrail: AuditEntryApi[];
  createdAt: string;
  decidedAt: string | null;
};

/** Matches client `LineDetail` (snake_case + joined arrays). */
export type LineDetailApi = {
  line_id: string;
  plant_id: string;
  line_name: string;
  machine_type: string;
  criticality: string;
  plant_lat: number;
  plant_lng: number;
  vibration_rms: number;
  temperature_c: number;
  utilization_pct: number;
  failure_risk_score: number;
  open_wo_count: number;
  has_open_corrective: boolean;
  candidate_part_id: string | null;
  part_local: boolean;
  part_unit_cost_usd: number | null;
  part_lead_time_days: number | null;
  risk_signal_score: number | null;
  downtime_exposure_usd: number;
  risk_band: RiskBandValue;
  work_orders: WorkOrderAppApi[];
  audit_trail: AuditEntryApi[];
};

/** Matches client `LinesSummary`. */
export type LinesSummaryApi = {
  risk_band: RiskBandValue;
  n: number;
  downtime_exposure_usd: number;
};

/** Matches client `PlantBucket`. */
export type PlantBucketApi = {
  plant_id: string;
  lat: number;
  lng: number;
  total_lines: number;
  critical_lines: number;
  downtime_exposure_usd: number;
};

/** Matches client `Part`. */
export type PartApi = {
  partId: string;
  partName: string;
  partType: string;
  machineType: string;
  unitCostUsd: number;
  leadTimeDays: number;
  localStockQty: number;
  description: string;
};

/** Matches client `MaintenanceRecommendation`. */
export type MaintenanceRecommendationApi = {
  lineId: string;
  recommendedAction: ActionTypeValue;
  predictedDowntimeCostAvoidedUsd: number;
  predictedNetValueUsd: number;
  actionRanking: MaintenanceActionOption[];
  scoredAt: string;
};

/** Matches client `ActivityEvent` (discriminated union). */
export type ActivityEventApi =
  | {
      kind: 'work_order';
      line_id: string;
      at: string;
      by: string;
      action: ActionTypeValue;
      downtime_avoided_usd: number;
    }
  | {
      kind: 'audit';
      line_id: string;
      at: string;
      by: string;
      action: string;
      notes: string | null;
    };

// --- small coercion helpers -------------------------------------------------
// The Lakebase pg driver returns float8/int4 as JS numbers and bool as boolean,
// but we coerce defensively so a null column (a client field with no backing
// column) degrades to a sensible default instead of throwing downstream.
const numOr = (v: unknown, dflt: number): number => (v == null ? dflt : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
function toRiskBand(v: unknown): RiskBandValue {
  return v === 'critical' || v === 'elevated' || v === 'watch' || v === 'healthy'
    ? v
    : 'healthy';
}

// The line SELECT is shared between listLines and getLineDetail. Kept as SQL
// fragments so the column list + joins live in exactly one place.
const LINE_COLUMNS = sql`
  ls.line_id, ls.plant_id, ls.line_name, ls.machine_type, ls.criticality,
  ls.plant_lat, ls.plant_lng, ls.vibration_rms, ls.temperature_c,
  ls.utilization_pct, ls.failure_risk_score, ls.open_wo_count,
  ls.has_open_corrective, ls.part_local, ls.risk_signal_score,
  ls.downtime_exposure_usd, ls.risk_band,
  oa.candidate_part_id AS candidate_part_id,
  oa.part_lead_time_days AS part_lead_time_days,
  p.unit_cost_usd AS part_unit_cost_usd
`;
const LINE_FROM = sql`
  FROM app.line_status ls
  LEFT JOIN app.open_atrisk oa ON oa.line_id = ls.line_id
  LEFT JOIN app.parts p ON p.part_id = oa.candidate_part_id
`;

function toLineStatusApi(r: Record<string, unknown>): LineStatusApi {
  return {
    lineId: String(r.line_id ?? ''),
    plantId: String(r.plant_id ?? ''),
    lineName: String(r.line_name ?? ''),
    machineType: r.machine_type == null ? '' : String(r.machine_type),
    criticality: r.criticality == null ? '' : String(r.criticality),
    plantLat: numOr(r.plant_lat, 0),
    plantLng: numOr(r.plant_lng, 0),
    vibrationRms: numOr(r.vibration_rms, 0),
    temperatureC: numOr(r.temperature_c, 0),
    utilizationPct: numOr(r.utilization_pct, 0),
    failureRiskScore: numOr(r.failure_risk_score, 0),
    openWoCount: numOr(r.open_wo_count, 0),
    hasOpenCorrective: Boolean(r.has_open_corrective),
    candidatePartId: r.candidate_part_id == null ? null : String(r.candidate_part_id),
    partLocal: Boolean(r.part_local),
    partUnitCostUsd: numOrNull(r.part_unit_cost_usd),
    partLeadTimeDays: numOrNull(r.part_lead_time_days),
    riskSignalScore: numOrNull(r.risk_signal_score),
    downtimeExposureUsd: numOr(r.downtime_exposure_usd, 0),
    riskBand: toRiskBand(r.risk_band),
  };
}

/**
 * The at-risk queue (LinesTable / PlantFloor3D / FacilityPanel). Optional
 * filters (all bound as parameters) narrow by risk band, plant, or machine
 * type; `sort` maps to a fixed ORDER BY fragment (never interpolated). Powers
 * GET /api/lines.
 */
export async function listLines(
  db: AppDb,
  filters: {
    riskBand?: string;
    plant?: string;
    machineType?: string;
    sort?: 'risk' | 'exposure' | 'vibration';
  } = {},
): Promise<LineStatusApi[]> {
  const conds: SQL[] = [];
  if (filters.riskBand) conds.push(sql`ls.risk_band = ${filters.riskBand}`);
  if (filters.plant) conds.push(sql`ls.plant_id = ${filters.plant}`);
  if (filters.machineType) conds.push(sql`ls.machine_type = ${filters.machineType}`);
  const whereSql = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  // `sort` is validated to this closed set by the caller; we branch on it and
  // emit a fixed column fragment, so no user input reaches the ORDER BY.
  const orderSql =
    filters.sort === 'risk'
      ? sql`ls.failure_risk_score DESC`
      : filters.sort === 'vibration'
        ? sql`ls.vibration_rms DESC NULLS LAST`
        : sql`ls.downtime_exposure_usd DESC`;
  const result = await db.execute(
    sql`SELECT ${LINE_COLUMNS} ${LINE_FROM} ${whereSql} ORDER BY ${orderSql}`,
  );
  return (result.rows as Record<string, unknown>[]).map(toLineStatusApi);
}

/**
 * Aggregate counts + exposure sum, one row per risk band. Powers the Plant
 * Floor KPI cards. GET /api/lines/summary.
 */
export async function linesSummary(db: AppDb): Promise<LinesSummaryApi[]> {
  const result = await db.execute(sql`
    SELECT
      risk_band,
      COUNT(*)::int AS n,
      COALESCE(SUM(downtime_exposure_usd), 0)::float8 AS downtime_exposure_usd
    FROM app.line_status
    GROUP BY risk_band
  `);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    risk_band: toRiskBand(r.risk_band),
    n: numOr(r.n, 0),
    downtime_exposure_usd: numOr(r.downtime_exposure_usd, 0),
  }));
}

/**
 * Per-plant rollup for the geospatial FacilityPanel: coordinates + line counts
 * + exposure sum, one row per plant. Optional risk-band filter narrows the
 * counted lines. GET /api/plants/map.
 */
export async function plantMap(
  db: AppDb,
  riskBand?: string,
): Promise<PlantBucketApi[]> {
  const whereSql = riskBand ? sql`WHERE risk_band = ${riskBand}` : sql``;
  const result = await db.execute(sql`
    SELECT
      plant_id,
      MAX(plant_lat)::float8 AS lat,
      MAX(plant_lng)::float8 AS lng,
      COUNT(*)::int AS total_lines,
      COUNT(*) FILTER (WHERE risk_band = 'critical')::int AS critical_lines,
      COALESCE(SUM(downtime_exposure_usd), 0)::float8 AS downtime_exposure_usd
    FROM app.line_status
    ${whereSql}
    GROUP BY plant_id
    ORDER BY downtime_exposure_usd DESC
  `);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    plant_id: String(r.plant_id ?? ''),
    lat: numOr(r.lat, 0),
    lng: numOr(r.lng, 0),
    total_lines: numOr(r.total_lines, 0),
    critical_lines: numOr(r.critical_lines, 0),
    downtime_exposure_usd: numOr(r.downtime_exposure_usd, 0),
  }));
}

/** Map a raw work_orders_app row to the client `WorkOrderApp` shape. */
function mapWorkOrder(row: typeof workOrdersApp.$inferSelect): WorkOrderAppApi {
  const auditTrail: AuditEntryApi[] = (row.auditTrail ?? []).map((a) => ({
    at: a.at,
    by: a.by,
    action: a.action,
    ...(a.notes != null ? { notes: a.notes } : {}),
  }));
  const toIso = (d: Date | string | null): string | null => {
    if (d == null) return null;
    return d instanceof Date ? d.toISOString() : String(d);
  };
  return {
    id: String(row.id),
    lineId: row.lineId,
    actionType: row.actionType,
    partId: row.partId,
    draftedWo: row.draftedWo,
    predictedDowntimeCostAvoidedUsd: numOr(row.predictedDowntimeCostAvoidsUsd, 0),
    status: row.status,
    approvedBy: row.approvedBy,
    auditTrail,
    createdAt: toIso(row.createdAt) ?? '',
    decidedAt: toIso(row.decidedAt),
  };
}

/**
 * A single line + its work orders + a flattened audit trail (the drawer's
 * three tabs). The audit trail is the union of every audit entry across the
 * line's work orders, matching how ActivityTabLine merges them. GET
 * /api/lines/:id. Returns null when the line id is unknown.
 */
export async function getLineDetail(
  db: AppDb,
  lineId: string,
): Promise<LineDetailApi | null> {
  const result = await db.execute(
    sql`SELECT ${LINE_COLUMNS} ${LINE_FROM} WHERE ls.line_id = ${lineId} LIMIT 1`,
  );
  const row = (result.rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const ls = toLineStatusApi(row);

  const woRows = await db
    .select()
    .from(workOrdersApp)
    .where(eq(workOrdersApp.lineId, lineId))
    .orderBy(desc(workOrdersApp.createdAt));
  const work_orders = woRows.map(mapWorkOrder);
  const audit_trail: AuditEntryApi[] = work_orders.flatMap((w) => w.auditTrail);

  return {
    line_id: ls.lineId,
    plant_id: ls.plantId,
    line_name: ls.lineName,
    machine_type: ls.machineType,
    criticality: ls.criticality,
    plant_lat: ls.plantLat,
    plant_lng: ls.plantLng,
    vibration_rms: ls.vibrationRms,
    temperature_c: ls.temperatureC,
    utilization_pct: ls.utilizationPct,
    failure_risk_score: ls.failureRiskScore,
    open_wo_count: ls.openWoCount,
    has_open_corrective: ls.hasOpenCorrective,
    candidate_part_id: ls.candidatePartId,
    part_local: ls.partLocal,
    part_unit_cost_usd: ls.partUnitCostUsd,
    part_lead_time_days: ls.partLeadTimeDays,
    risk_signal_score: ls.riskSignalScore,
    downtime_exposure_usd: ls.downtimeExposureUsd,
    risk_band: ls.riskBand,
    work_orders,
    audit_trail,
  };
}

/**
 * The ranked-action recommendation for a line, mapped to the client
 * `MaintenanceRecommendation` shape. `predictedNetValueUsd` is taken from the
 * recommended action's option in the ranking (falling back to its avoided
 * cost, then 0). GET /api/lines/:id/recommendation. Returns null when the line
 * has no recommendation yet.
 */
export async function getRecommendationApi(
  db: AppDb,
  lineId: string,
): Promise<MaintenanceRecommendationApi | null> {
  const rec = await getRecommendation(db, lineId);
  if (!rec) return null;
  const chosen = rec.actionRanking.find((o) => o.action === rec.recommendedAction);
  const predictedNetValueUsd =
    chosen?.estimatedNetValueUsd ??
    chosen?.predictedDowntimeCostAvoidsUsd ??
    rec.predictedDowntimeCostUsd ??
    0;
  return {
    lineId: rec.lineId,
    recommendedAction: rec.recommendedAction,
    predictedDowntimeCostAvoidedUsd: rec.predictedDowntimeCostUsd ?? 0,
    predictedNetValueUsd,
    actionRanking: rec.actionRanking,
    scoredAt: rec.scoredAt ? rec.scoredAt.toISOString() : '',
  };
}

/**
 * Fetch one work order by its numeric id, mapped to the client shape. Used by
 * the work-order POST to return the freshly-committed row.
 */
export async function getWorkOrderById(
  db: AppDb,
  id: number,
): Promise<WorkOrderAppApi | null> {
  const rows = await db
    .select()
    .from(workOrdersApp)
    .where(eq(workOrdersApp.id, id))
    .limit(1);
  return rows[0] ? mapWorkOrder(rows[0]) : null;
}

/**
 * Recent activity feed (Home page): the most recent work orders expanded into
 * a work_order event each, plus one audit event per audit-trail entry, merged
 * and sorted newest-first. GET /api/activity/recent.
 */
export async function recentActivity(
  db: AppDb,
  limit = 20,
): Promise<ActivityEventApi[]> {
  const capped = Math.max(1, Math.min(Math.floor(limit) || 20, 100));
  const rows = await db
    .select()
    .from(workOrdersApp)
    .orderBy(desc(workOrdersApp.createdAt))
    .limit(capped);

  const events: ActivityEventApi[] = [];
  for (const row of rows) {
    const wo = mapWorkOrder(row);
    events.push({
      kind: 'work_order',
      line_id: wo.lineId,
      at: wo.decidedAt ?? wo.createdAt,
      by: wo.approvedBy ?? 'system',
      action: wo.actionType,
      downtime_avoided_usd: wo.predictedDowntimeCostAvoidedUsd,
    });
    for (const a of wo.auditTrail) {
      events.push({
        kind: 'audit',
        line_id: wo.lineId,
        at: a.at,
        by: a.by,
        action: a.action,
        notes: a.notes ?? null,
      });
    }
  }
  events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return events.slice(0, capped);
}

/**
 * Full-detail part search for GET /api/parts/search. Reuses the existing
 * `searchParts` hybrid ranking (Lakebase Search / Postgres FTS) to order
 * candidates, then enriches each with the full parts-catalog row so the client
 * `Part` shape is complete. Ranking order from searchParts is preserved.
 *
 * Two `Part` fields have no backing column in app.parts and are defaulted:
 *   - machineType   → '' (app.parts has no machine_type column)
 *   - localStockQty → 0  (app.parts tracks part_local boolean, not a quantity)
 */
export async function searchPartsDetailed(
  db: AppDb,
  query: string,
): Promise<PartApi[]> {
  const matches = await searchParts(db, query);
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.part_id);
  const rows = await db.select().from(parts).where(inArray(parts.partId, ids));
  const byId = new Map(rows.map((r) => [r.partId, r]));
  return matches.map((m) => {
    const r = byId.get(m.part_id);
    return {
      partId: m.part_id,
      partName: r?.partName ?? m.part_name,
      partType: r?.partCategory ?? m.part_category ?? '',
      machineType: '',
      unitCostUsd: r?.unitCostUsd == null ? 0 : Number(r.unitCostUsd),
      leadTimeDays:
        r?.leadTimeDays == null ? (m.lead_time_days ?? 0) : Number(r.leadTimeDays),
      localStockQty: 0,
      description: r?.description ?? '',
    };
  });
}
