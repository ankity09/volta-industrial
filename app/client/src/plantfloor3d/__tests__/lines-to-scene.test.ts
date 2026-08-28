import { describe, it, expect } from 'vitest';
import { linesToScene, RISK_PRIORITY } from '../lines-to-scene';
import type { LineStatus, RiskBand } from '@/shared/types';

// Minimal LineStatus factory — only the fields the mapping reads matter.
function line(over: Partial<LineStatus> & { lineId: string; plantId: string }): LineStatus {
  return {
    lineName: over.lineId,
    machineType: 'CNC_Mill',
    criticality: 'high',
    plantLat: 0,
    plantLng: 0,
    vibrationRms: 0,
    temperatureC: 0,
    utilizationPct: 0,
    failureRiskScore: 0,
    openWoCount: 0,
    hasOpenCorrective: false,
    candidatePartId: null,
    partLocal: false,
    partUnitCostUsd: null,
    partLeadTimeDays: null,
    riskSignalScore: null,
    downtimeExposureUsd: 0,
    riskBand: 'healthy' as RiskBand,
    ...over,
  };
}

describe('linesToScene', () => {
  it('groups lines into one bay per distinct plantId', () => {
    const lines = [
      line({ lineId: 'L1', plantId: 'PLANT-01' }),
      line({ lineId: 'L2', plantId: 'PLANT-01' }),
      line({ lineId: 'L3', plantId: 'PLANT-02' }),
    ];
    const model = linesToScene(lines);
    expect(model.bays).toHaveLength(2);
    expect(model.bays.map((b) => b.plantId).sort()).toEqual(['PLANT-01', 'PLANT-02']);
    expect(model.bays.find((b) => b.plantId === 'PLANT-01')!.lineCount).toBe(2);
  });

  it('produces exactly one instance per input line', () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      line({ lineId: `L${i}`, plantId: `PLANT-0${(i % 8) + 1}` }),
    );
    const model = linesToScene(lines);
    expect(model.instances).toHaveLength(25);
  });

  it('maps riskBand to the app RISK_BAND_HEX color', () => {
    const model = linesToScene([
      line({ lineId: 'C', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'H', plantId: 'PLANT-01', riskBand: 'healthy' }),
    ]);
    const crit = model.instances.find((i) => i.lineId === 'C')!;
    const heal = model.instances.find((i) => i.lineId === 'H')!;
    expect(crit.colorHex).toBe(0xe5484d);
    expect(heal.colorHex).toBe(0x3c6997);
    expect(crit.emphasized).toBe(true);
    expect(heal.emphasized).toBe(false);
  });

  it('picks hero = max downtimeExposureUsd', () => {
    const model = linesToScene([
      line({ lineId: 'A', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 100 }),
      line({ lineId: 'B', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 500 }),
      line({ lineId: 'C', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 300 }),
    ]);
    expect(model.heroLineId).toBe('B');
  });

  it('breaks an exposure tie by failureRiskScore desc, then lineId asc (deterministic)', () => {
    const model = linesToScene([
      line({ lineId: 'LINE-0317', plantId: 'PLANT-02', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.8 }),
      line({ lineId: 'LINE-0031', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
      line({ lineId: 'LINE-0122', plantId: 'PLANT-03', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
    ]);
    // Highest failureRiskScore is a tie (0.9) between LINE-0031 and LINE-0122;
    // lineId asc breaks it → LINE-0031.
    expect(model.heroLineId).toBe('LINE-0031');
  });

  it('counts risk bands correctly', () => {
    const model = linesToScene([
      line({ lineId: 'a', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'b', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'c', plantId: 'PLANT-01', riskBand: 'watch' }),
      line({ lineId: 'd', plantId: 'PLANT-01', riskBand: 'healthy' }),
    ]);
    expect(model.counts).toMatchObject({ total: 4, critical: 2, watch: 1, healthy: 1, elevated: 0 });
    expect(model.bays[0].criticalCount).toBe(2);
  });

  it('is stable: same input → identical instance order and positions', () => {
    const lines = [
      line({ lineId: 'L3', plantId: 'PLANT-01' }),
      line({ lineId: 'L1', plantId: 'PLANT-01' }),
      line({ lineId: 'L2', plantId: 'PLANT-01' }),
    ];
    const a = linesToScene(lines);
    const b = linesToScene([...lines]);
    expect(a.instances.map((i) => [i.lineId, i.x, i.z])).toEqual(
      b.instances.map((i) => [i.lineId, i.x, i.z]),
    );
  });

  it('handles empty input without throwing', () => {
    const model = linesToScene([]);
    expect(model.bays).toEqual([]);
    expect(model.instances).toEqual([]);
    expect(model.heroLineId).toBeNull();
    expect(model.counts.total).toBe(0);
  });

  it('exposes a RISK_PRIORITY ordering with critical highest', () => {
    expect(RISK_PRIORITY.critical).toBeGreaterThan(RISK_PRIORITY.elevated);
    expect(RISK_PRIORITY.elevated).toBeGreaterThan(RISK_PRIORITY.watch);
    expect(RISK_PRIORITY.watch).toBeGreaterThan(RISK_PRIORITY.healthy);
  });
});
