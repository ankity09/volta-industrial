/**
 * Plant-floor REST routes: lines / plants / parts / activity + the work-order
 * write. These back the fetch helpers in client/src/lib/lines.ts — the eight
 * endpoints the deployed client calls that previously had no server route
 * (every one 404'd, so the Plant Floor page, Home activity feed, and Analytics
 * facility panel rendered empty).
 *
 *   GET  /api/lines                     → LineStatus[]      (listLines)
 *   GET  /api/lines/summary             → LinesSummary[]    (linesSummary)
 *   GET  /api/lines/:id                 → LineDetail        (getLineDetail)
 *   GET  /api/lines/:id/recommendation  → MaintenanceRecommendation | null
 *   GET  /api/plants/map                → PlantBucket[]     (plantMap)
 *   GET  /api/parts/search              → Part[]            (searchPartsDetailed)
 *   GET  /api/activity/recent           → ActivityEvent[]   (recentActivity)
 *   POST /api/lines/:id/work-order      → WorkOrderApp      (recordMaintenanceAction)
 *
 * Route ORDER matters: `/api/lines/summary` is registered BEFORE
 * `/api/lines/:id` so "summary" is not captured as an :id. All queries live in
 * db/queries/maintenance.ts (Drizzle + parameterized SQL); this file is thin
 * request/response plumbing + input validation only. Express 5 forwards async
 * errors to the global handler in server.ts, so handlers don't need try/catch.
 *
 * On the "dataMutated" event the work-order POST must trigger: `dataMutated`
 * is a CLIENT-SIDE pub/sub bus (client/src/lib/events.ts). There is no server
 * push, SSE, or socket the client listens on — the client emits `dataMutated`
 * itself at chat-turn-end, and each subscribing surface refetches these
 * endpoints. The server's contract is therefore to make the write DURABLE and
 * VISIBLE before the response resolves: recordMaintenanceAction commits the row
 * inside a transaction, and this handler returns the freshly-committed row, so
 * the very next refetch (whatever fires it) surfaces the new work order. That
 * commit-before-response is exactly what db/queries/maintenance.ts documents as
 * "what makes the client's turn-end dataMutated refetch surface the write".
 */
import type { Application, Request, Response } from 'express';
import express from 'express';
import type { AppDb } from '../db/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import {
  listLines,
  linesSummary,
  plantMap,
  getLineDetail,
  getRecommendationApi,
  searchPartsDetailed,
  recentActivity,
  recordMaintenanceAction,
  getWorkOrderById,
  getRecommendation,
  type ActionTypeValue,
} from '../db/queries/index.js';

// The closed set of sort keys accepted by GET /api/lines. Anything else falls
// through to the default (exposure) so a bad query string can't break the
// ORDER BY (which is a fixed fragment keyed off this value, never interpolated).
const SORT_KEYS = new Set(['risk', 'exposure', 'vibration']);
function parseSort(v: unknown): 'risk' | 'exposure' | 'vibration' | undefined {
  return typeof v === 'string' && SORT_KEYS.has(v)
    ? (v as 'risk' | 'exposure' | 'vibration')
    : undefined;
}

// The three write actions the client can request. Validated so a malformed
// POST body surfaces as a 400 rather than a DB enum-constraint 500.
const ACTION_TYPES = new Set<ActionTypeValue>([
  'pull_now',
  'run_to_shift_end',
  'expedite_parts_and_run',
]);
function isActionType(v: unknown): v is ActionTypeValue {
  return typeof v === 'string' && ACTION_TYPES.has(v as ActionTypeValue);
}

/** Read a single optional string query param (Express can hand back arrays). */
function strParam(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

export function registerLinesRoutes(app: Application, db: AppDb): void {
  // GET /api/lines — the at-risk queue, with optional filters + sort.
  app.get('/api/lines', async (req: Request, res: Response) => {
    const rows = await listLines(db, {
      riskBand: strParam(req.query.riskBand),
      plant: strParam(req.query.plant),
      machineType: strParam(req.query.machineType),
      sort: parseSort(req.query.sort),
    });
    res.json(rows);
  });

  // GET /api/lines/summary — one row per risk band (counts + exposure sum).
  // MUST be registered before /api/lines/:id so "summary" isn't read as an id.
  app.get('/api/lines/summary', async (_req: Request, res: Response) => {
    res.json(await linesSummary(db));
  });

  // GET /api/lines/:id/recommendation — ranked maintenance actions or null.
  // Registered before /api/lines/:id for clarity (Express matches the more
  // specific path regardless, but keeping related routes together reads well).
  app.get(
    '/api/lines/:id/recommendation',
    async (req: Request, res: Response) => {
      const rec = await getRecommendationApi(db, String(req.params.id));
      res.json(rec); // null is a valid body — the client types it as | null.
    },
  );

  // GET /api/lines/:id — a line + its work orders + flattened audit trail.
  app.get('/api/lines/:id', async (req: Request, res: Response) => {
    const detail = await getLineDetail(db, String(req.params.id));
    if (!detail) {
      res.status(404).json({ error: `Unknown line: ${req.params.id}` });
      return;
    }
    res.json(detail);
  });

  // POST /api/lines/:id/work-order — record an approved maintenance action.
  // Body: { action: ActionType, partId: string | null, draftedWo: string }.
  // Stamps the OBO user as approver, commits transactionally, returns the row.
  app.post(
    '/api/lines/:id/work-order',
    express.json(),
    async (req: Request, res: Response) => {
      const lineId = String(req.params.id);
      const body = (req.body ?? {}) as {
        action?: unknown;
        partId?: unknown;
        draftedWo?: unknown;
      };

      if (!isActionType(body.action)) {
        res.status(400).json({
          error:
            'Invalid or missing "action" (expected pull_now, run_to_shift_end, or expedite_parts_and_run).',
        });
        return;
      }
      const action = body.action;
      const partId =
        typeof body.partId === 'string' && body.partId.length > 0
          ? body.partId
          : null;
      const draftedWo = typeof body.draftedWo === 'string' ? body.draftedWo : '';
      if (!draftedWo) {
        res.status(400).json({ error: 'Missing "draftedWo" text.' });
        return;
      }

      // The client POST carries no predicted-cost figure; pull it from the
      // line's recommendation (the chosen action's avoided cost) so the row's
      // predicted_downtime_cost_avoided_usd matches what the model ranked.
      // Null when the line has no recommendation yet — the column is nullable.
      const rec = await getRecommendation(db, lineId);
      const chosen = rec?.actionRanking.find((o) => o.action === action);
      const predictedDowntimeCostAvoidsUsd =
        chosen?.predictedDowntimeCostAvoidsUsd ??
        rec?.predictedDowntimeCostUsd ??
        null;

      const { actionId } = await recordMaintenanceAction(db, {
        lineId,
        actionType: action,
        partId,
        draftedWorkOrder: draftedWo,
        predictedDowntimeCostAvoidsUsd,
        userEmail: getCurrentUserEmail(req),
      });

      // The write is committed. Return the persisted row so the caller (and the
      // next dataMutated-driven refetch) sees the exact durable state.
      // recordMaintenanceAction's return type annotates actionId as `string`,
      // but work_orders_app.id is a bigint({ mode: 'number' }) identity, so the
      // value is a number at runtime — coerce to satisfy getWorkOrderById's
      // numeric id without touching the shared helper's signature.
      const wo = await getWorkOrderById(db, Number(actionId));
      if (!wo) {
        res
          .status(500)
          .json({ error: 'Work order was written but could not be read back.' });
        return;
      }
      res.status(201).json(wo);
    },
  );

  // GET /api/plants/map — per-plant rollup for the geospatial facility panel.
  app.get('/api/plants/map', async (req: Request, res: Response) => {
    res.json(await plantMap(db, strParam(req.query.riskBand)));
  });

  // GET /api/parts/search — hybrid part search (reuses searchParts ranking).
  app.get('/api/parts/search', async (req: Request, res: Response) => {
    const q = strParam(req.query.q) ?? '';
    res.json(await searchPartsDetailed(db, q));
  });

  // GET /api/activity/recent — merged work-order + audit feed, newest first.
  app.get('/api/activity/recent', async (req: Request, res: Response) => {
    const limitRaw = Number(strParam(req.query.limit) ?? '20');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    res.json(await recentActivity(db, limit));
  });
}
