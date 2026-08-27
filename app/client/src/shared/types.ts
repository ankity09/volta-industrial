/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/lines.ts + server/db/queries/chat.ts.
 *
 * The app is small enough that hand-copying these is simpler than a
 * shared package. If this file grows past ~200 lines, consider a
 * proper shared lib.
 *
 * ─────────────────────────────────────────────────────────────────────
 * VOLTA INDUSTRIAL — Predictive Maintenance Domain
 * ─────────────────────────────────────────────────────────────────────
 * This is the canonical schema for Volta's plant-floor use case — at-risk
 * production lines, ranked maintenance actions, and work-order execution.
 * Every page, fetch helper, badge, and SQL projection uses what's defined
 * here.
 * ───────────────────────────────────────────────────────────────────── */

export type RiskBand = 'critical' | 'elevated' | 'watch' | 'healthy';
export type ActionType = 'pull_now' | 'run_to_shift_end' | 'expedite_parts_and_run';
export type WorkOrderStatus = 'proposed' | 'approved' | 'executed' | 'overridden';

export type LineStatus = {
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
  riskBand: RiskBand;
};

export type MaintenanceRecommendation = {
  lineId: string;
  recommendedAction: ActionType;
  predictedDowntimeCostAvoidedUsd: number;
  predictedNetValueUsd: number;
  actionRanking: Record<string, unknown>;
  scoredAt: string;
};

export type WorkOrderApp = {
  id: string;
  lineId: string;
  actionType: ActionType;
  partId: string | null;
  draftedWo: string;
  predictedDowntimeCostAvoidedUsd: number;
  status: WorkOrderStatus;
  approvedBy: string | null;
  auditTrail: AuditEntry[];
  createdAt: string;
  decidedAt: string | null;
};

export type Part = {
  partId: string;
  partName: string;
  partType: string;
  machineType: string;
  unitCostUsd: number;
  leadTimeDays: number;
  localStockQty: number;
  description: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: string;
  notes?: string;
};

export type LineDetail = {
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
  risk_band: RiskBand;
  work_orders: WorkOrderApp[];
  audit_trail: AuditEntry[];
};

export type LinesSummary = {
  risk_band: RiskBand;
  n: number;
  downtime_exposure_usd: number;
};

export type PlantBucket = {
  plant_id: string;
  lat: number;
  lng: number;
  total_lines: number;
  critical_lines: number;
  downtime_exposure_usd: number;
};

export type ActivityEvent =
  | {
      kind: 'work_order';
      line_id: string;
      at: string;
      by: string;
      action: ActionType;
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
