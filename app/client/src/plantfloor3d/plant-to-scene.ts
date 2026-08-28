/**
 * Pure mapper: LineStatus[] → PlantSceneModel.
 * No Three.js, no React, no I/O — testable in node.
 * Deterministic layout + stable machine ordering.
 */

import { RISK_BAND_HEX } from '@/plantfloor/types';
import type { LineStatus } from '@/shared/types';
import type {
  MachineType,
  MachineModel,
  NeighborhoodModel,
  PlantSceneModel,
  SceneCounts,
} from './scene.types';

/**
 * Canonical machine-type order (key order of MACHINE_LABELS).
 * Use this everywhere to ensure deterministic layout regardless of input order.
 */
const MACHINE_LABELS: Record<MachineType, string> = {
  Hydraulic_Press: 'Press Shop',
  Assembly_Robot: 'Robot Cell',
  Welding_Cell: 'Weld Bay',
  CNC_Mill: 'CNC Row',
  Grinder: 'Grind Line',
  Injection_Molder: 'Molding',
};

const CANONICAL_MACHINE_TYPES = Object.keys(MACHINE_LABELS) as MachineType[];

/** Grid spacing and layout constants. */
const DISTRICT = 24; // World units per neighborhood
const DISTRICT_OFFSET_X = 36; // Center the grid around origin
const DISTRICT_OFFSET_Z = 12;
const CELL = 3.0; // Machine spacing within neighborhood
const NEIGHBORHOOD_MARGIN = 2.0;

/**
 * Pick the "hero" line (camera focus): max downtimeExposureUsd,
 * tiebroken by failureRiskScore desc, then lineId asc.
 * Returns null if lines is empty.
 */
function pickHero(lines: LineStatus[]): string | null {
  if (lines.length === 0) return null;

  return lines.reduce((best, current) => {
    // Compare downtimeExposureUsd (desc)
    if (current.downtimeExposureUsd > best.downtimeExposureUsd) return current;
    if (current.downtimeExposureUsd < best.downtimeExposureUsd) return best;

    // Tie on exposure: compare failureRiskScore (desc)
    if (current.failureRiskScore > best.failureRiskScore) return current;
    if (current.failureRiskScore < best.failureRiskScore) return best;

    // Tie on score: compare lineId (asc)
    return current.lineId < best.lineId ? current : best;
  }).lineId;
}

/**
 * Map lines to PlantSceneModel: neighborhoods in canonical order,
 * machines within sorted by lineId.
 */
export function plantToScene(lines: LineStatus[]): PlantSceneModel {
  if (lines.length === 0) {
    return {
      plantId: '',
      neighborhoods: [],
      machines: [],
      heroLineId: null,
      counts: { total: 0, critical: 0, elevated: 0, watch: 0, healthy: 0 },
    };
  }

  // Determine plantId from the first raw line (before filtering, so a plant
  // whose rows all have an unrecognized machineType still reports its id).
  const plantId = lines[0].plantId;

  // Crash insurance: drop any line whose machineType isn't one of the 6 known
  // types. The engine's buildMachine() is a non-default switch that returns
  // undefined for an out-of-union value, which would throw and take down the
  // whole 3D tab; dropping one bad row degrades gracefully instead. Safe for
  // the current seeded data (all 6 types present); guards against data drift.
  const knownTypes = new Set<string>(CANONICAL_MACHINE_TYPES);
  const validLines = lines.filter((l) => knownTypes.has(l.machineType));

  // Count risk bands over the lines we actually render.
  const counts: SceneCounts = {
    total: validLines.length,
    critical: 0,
    elevated: 0,
    watch: 0,
    healthy: 0,
  };

  for (const line of validLines) {
    counts[line.riskBand]++;
  }

  // Group lines by machineType
  const linesByType = new Map<MachineType, LineStatus[]>();
  for (const line of validLines) {
    const machineType = line.machineType as MachineType;
    if (!linesByType.has(machineType)) {
      linesByType.set(machineType, []);
    }
    linesByType.get(machineType)!.push(line);
  }

  // Build neighborhoods in canonical order
  const neighborhoods: NeighborhoodModel[] = [];
  const machines: MachineModel[] = [];

  CANONICAL_MACHINE_TYPES.forEach((machineType, index) => {
    const typeLines = linesByType.get(machineType);
    if (!typeLines) return; // This type is not present

    // Sort lines within neighborhood by lineId for determinism
    const sortedLines = typeLines.slice().sort((a, b) => a.lineId.localeCompare(b.lineId));

    // Calculate grid layout within this neighborhood
    const cols = Math.ceil(Math.sqrt(sortedLines.length));
    const rows = Math.ceil(sortedLines.length / cols);

    // Neighborhood center position in the 3-column grid
    const col = index % 3;
    const row = Math.floor(index / 3);
    const centerX = col * DISTRICT - DISTRICT_OFFSET_X;
    const centerZ = row * DISTRICT - DISTRICT_OFFSET_Z;

    // Neighborhood dimensions
    const halfW = (cols * CELL) / 2 + NEIGHBORHOOD_MARGIN;
    const halfD = (rows * CELL) / 2 + NEIGHBORHOOD_MARGIN;

    // Count criticals in this neighborhood
    let criticalCount = 0;
    for (const line of sortedLines) {
      if (line.riskBand === 'critical') criticalCount++;
    }

    neighborhoods.push({
      machineType,
      label: MACHINE_LABELS[machineType],
      centerX,
      centerZ,
      halfW,
      halfD,
      machineCount: sortedLines.length,
      criticalCount,
    });

    // Place machines within this neighborhood
    sortedLines.forEach((line, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = centerX + (c - (cols - 1) / 2) * CELL;
      const z = centerZ + (r - (rows - 1) / 2) * CELL;

      const emphasized = line.riskBand === 'critical' || line.riskBand === 'elevated';
      const colorHex = RISK_BAND_HEX[line.riskBand] ?? RISK_BAND_HEX.healthy;

      machines.push({
        lineId: line.lineId,
        lineName: line.lineName,
        machineType,
        riskBand: line.riskBand,
        failureRiskScore: line.failureRiskScore,
        downtimeExposureUsd: line.downtimeExposureUsd,
        x,
        z,
        colorHex,
        emphasized,
      });
    });
  });

  return {
    plantId,
    neighborhoods,
    machines,
    heroLineId: pickHero(validLines),
    counts,
  };
}
