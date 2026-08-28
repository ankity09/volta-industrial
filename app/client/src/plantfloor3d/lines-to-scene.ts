/**
 * PURE mapping: the app's LineStatus[] (GET /api/lines, all ~1,200 rows) →
 * a SceneModel the vanilla-Three engine renders. No Three.js, no React, no
 * fetch — deterministic and unit-testable in the node env.
 *
 * Layout: one bay per plant, bays arranged left→right in a shallow arc grid.
 * Within a bay, lines fill a near-square grid of same-size cabinet slots in
 * stable lineId order, so a given line always lands in the same spot (the
 * camera can fly to it and re-renders don't reshuffle the floor).
 */
import type { LineStatus, RiskBand } from '@/shared/types';
import { RISK_BAND_HEX } from '@/plantfloor/types';
import type { SceneModel, BayModel, InstanceModel, SceneCounts } from './scene.types';

/** Higher = more visually urgent. Drives emphasis + (future) sort. */
export const RISK_PRIORITY: Record<RiskBand, number> = {
  critical: 3,
  elevated: 2,
  watch: 1,
  healthy: 0,
};

// --- Layout constants (world units). Tuned so 8 bays of ~150 cabinets read
// as a factory floor from the establishing shot yet stay legible on zoom. ---
const CELL = 2.2;          // spacing between cabinet centers within a bay
const BAY_GAP = 6;         // gap between adjacent bays
const BAYS_PER_ROW = 4;    // 8 plants → 4 x 2 arrangement

function riskColor(band: RiskBand): number {
  return RISK_BAND_HEX[band] ?? RISK_BAND_HEX.healthy;
}

/** Near-square grid dimensions for n items (cols >= rows). */
function gridDims(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function linesToScene(lines: LineStatus[]): SceneModel {
  // 1. Group by plant, in ascending plantId order (stable, matches PLANT-01..08).
  const byPlant = new Map<string, LineStatus[]>();
  for (const l of lines) {
    const arr = byPlant.get(l.plantId);
    if (arr) arr.push(l);
    else byPlant.set(l.plantId, [l]);
  }
  const plantIds = [...byPlant.keys()].sort();

  const bays: BayModel[] = [];
  const instances: InstanceModel[] = [];
  const counts: SceneCounts = { total: 0, critical: 0, elevated: 0, watch: 0, healthy: 0 };

  // Precompute bay footprints so we can center the whole floor around origin.
  const bayGrids = plantIds.map((pid) => gridDims(byPlant.get(pid)!.length));
  const bayW = bayGrids.map((g) => Math.max(1, g.cols) * CELL);
  const bayD = bayGrids.map((g) => Math.max(1, g.rows) * CELL);

  // Uniform bay pitch = widest bay + gap (keeps the arc regular + readable).
  const maxBayW = Math.max(CELL, ...bayW);
  const maxBayD = Math.max(CELL, ...bayD);
  const pitchX = maxBayW + BAY_GAP;
  const pitchZ = maxBayD + BAY_GAP;

  const rowsOfBays = Math.ceil(plantIds.length / BAYS_PER_ROW);
  const floorOffsetX = ((Math.min(plantIds.length, BAYS_PER_ROW) - 1) * pitchX) / 2;
  const floorOffsetZ = ((rowsOfBays - 1) * pitchZ) / 2;

  plantIds.forEach((pid, bi) => {
    const bayLines = byPlant.get(pid)!.slice().sort((a, b) => a.lineId.localeCompare(b.lineId));
    const { cols, rows } = bayGrids[bi];

    const bayRow = Math.floor(bi / BAYS_PER_ROW);
    const bayColIdx = bi % BAYS_PER_ROW;
    const centerX = bayColIdx * pitchX - floorOffsetX;
    const centerZ = bayRow * pitchZ - floorOffsetZ;

    // Grid origin = top-left cabinet of the bay, centered on the bay center.
    const originX = centerX - ((cols - 1) * CELL) / 2;
    const originZ = centerZ - ((rows - 1) * CELL) / 2;

    let criticalCount = 0;
    bayLines.forEach((l, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const band = l.riskBand;
      const emphasized = band === 'critical' || band === 'elevated';
      if (band === 'critical') criticalCount++;
      counts[band] = (counts[band] ?? 0) + 1;
      counts.total++;
      instances.push({
        lineId: l.lineId,
        plantId: l.plantId,
        lineName: l.lineName,
        machineType: l.machineType,
        riskBand: band,
        failureRiskScore: l.failureRiskScore,
        downtimeExposureUsd: l.downtimeExposureUsd,
        col,
        row,
        x: originX + col * CELL,
        z: originZ + row * CELL,
        colorHex: riskColor(band),
        emphasized,
      });
    });

    bays.push({
      plantId: pid,
      label: pid,
      centerX,
      centerZ,
      halfW: (Math.max(1, cols) * CELL) / 2 + 0.6,
      halfD: (Math.max(1, rows) * CELL) / 2 + 0.6,
      lineCount: bayLines.length,
      criticalCount,
    });
  });

  return { bays, instances, heroLineId: pickHero(lines), counts };
}

/**
 * The single line the camera flies to on load: highest downtime exposure,
 * tie-broken by failureRiskScore desc then lineId asc so it is deterministic
 * (the real data has a 5-way exposure tie at $41,800).
 */
function pickHero(lines: LineStatus[]): string | null {
  let best: LineStatus | null = null;
  for (const l of lines) {
    if (best === null) {
      best = l;
      continue;
    }
    if (l.downtimeExposureUsd > best.downtimeExposureUsd) best = l;
    else if (l.downtimeExposureUsd === best.downtimeExposureUsd) {
      if (l.failureRiskScore > best.failureRiskScore) best = l;
      else if (l.failureRiskScore === best.failureRiskScore && l.lineId < best.lineId) best = l;
    }
  }
  return best ? best.lineId : null;
}
