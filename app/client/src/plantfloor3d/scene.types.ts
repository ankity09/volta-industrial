/**
 * Shared shapes for the Plant Floor 3D tab: the pure mapping
 * (lines-to-scene.ts) produces a SceneModel; the vanilla-Three engine
 * (scene.ts) consumes it; the React view (PlantFloor3DView.tsx) drives both.
 * Kept dependency-free so the mapping stays unit-testable in the node env.
 */
import type { RiskBand } from '@/shared/types';

/** One production line rendered as a single cabinet instance. */
export interface InstanceModel {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: string;
  riskBand: RiskBand;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  /** Grid slot within the bay (col, row), 0-indexed. */
  col: number;
  row: number;
  /** World position, precomputed so the engine just reads x/z (y is fixed). */
  x: number;
  z: number;
  /** 0xRRGGBB from RISK_BAND_HEX — the cabinet's color. */
  colorHex: number;
  /** True for critical/elevated (pop + emissive); false for watch/healthy (dim). */
  emphasized: boolean;
}

/** One plant = one floor tile + label, holding a grid of line cabinets. */
export interface BayModel {
  plantId: string;
  label: string;
  /** Bay center in world space + tile half-extents (for the floor plane). */
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  lineCount: number;
  criticalCount: number;
}

export interface SceneCounts {
  total: number;
  critical: number;
  elevated: number;
  watch: number;
  healthy: number;
}

export interface SceneModel {
  bays: BayModel[];
  instances: InstanceModel[];
  /** The single line the on-load camera flies to. Null only if zero lines. */
  heroLineId: string | null;
  counts: SceneCounts;
}

/** Fired when the user clicks a cabinet. */
export interface SelectPayload {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: string;
  riskBand: RiskBand;
}

/** Imperative handle the React view holds onto. */
export interface SceneHandle {
  setLines(model: SceneModel): void;
  focusLine(lineId: string): void;
  onSelect(cb: (payload: SelectPayload) => void): void;
  resize(): void;
  dispose(): void;
}

export interface SceneOptions {
  /** Disable bloom/animation for reduced-motion or perf fallback. */
  reducedMotion?: boolean;
}
