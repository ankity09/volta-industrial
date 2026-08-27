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
import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  lineStatus,
  openAtrisk,
  maintenanceRecommendations,
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
