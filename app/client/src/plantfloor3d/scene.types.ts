/**
 * Shared shapes for the Plant Floor 3D tab (v2 — cinematic single-plant).
 * The pure mapper (plant-to-scene.ts) produces a PlantSceneModel; the vanilla
 * Three engine (scene.ts) consumes it via setPlant(); the React view drives both.
 * Dependency-free so the mapper stays unit-testable in the node env.
 */
import type { RiskBand } from '@/shared/types';

/** The 6 machine types in the data (literal values of LineStatus.machineType). */
export type MachineType =
  | 'Hydraulic_Press'
  | 'Assembly_Robot'
  | 'Welding_Cell'
  | 'CNC_Mill'
  | 'Grinder'
  | 'Injection_Molder';

/** One production line = one machine, placed within its neighborhood. */
export interface MachineModel {
  lineId: string;
  lineName: string;
  machineType: MachineType;
  riskBand: RiskBand;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  /** World position on the floor (y is fixed per machine type). */
  x: number;
  z: number;
  /** 0xRRGGBB from RISK_BAND_HEX. */
  colorHex: number;
  /** critical|elevated → dramatic motion + pop; watch|healthy → quiet idle. */
  emphasized: boolean;
}

/** One machine-type district on the floor. */
export interface NeighborhoodModel {
  machineType: MachineType;
  label: string; // e.g. "Press Shop"
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  machineCount: number;
  criticalCount: number;
}

export interface SceneCounts {
  total: number;
  critical: number;
  elevated: number;
  watch: number;
  healthy: number;
}

/** The whole model for ONE plant. */
export interface PlantSceneModel {
  plantId: string;
  neighborhoods: NeighborhoodModel[];
  machines: MachineModel[];
  /** The line the camera flies to on load. Null only if the plant has 0 lines. */
  heroLineId: string | null;
  counts: SceneCounts;
}

export interface SelectPayload {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: MachineType;
  riskBand: RiskBand;
}

export interface SceneHandle {
  setPlant(model: PlantSceneModel): void;
  focusLine(lineId: string): void;
  onSelect(cb: (payload: SelectPayload) => void): void;
  /** Dim machines whose band !== the active one; 'all' restores full. */
  highlightRisk(band: RiskBand | 'all'): void;
  resize(): void;
  dispose(): void;
}

export interface SceneOptions {
  reducedMotion?: boolean;
}
