import { describe, it, expect } from 'vitest';
import { plantToScene } from '../plant-to-scene';
import type { LineStatus, RiskBand } from '@/shared/types';
import type { MachineType } from '../scene.types';

function line(over: Partial<LineStatus> & { lineId: string; machineType: MachineType }): LineStatus {
  return {
    plantId: 'PLANT-01',
    lineName: over.lineId,
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

describe('plantToScene', () => {
  it('creates one neighborhood per distinct machineType present', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Hydraulic_Press' }),
      line({ lineId: 'b', machineType: 'Hydraulic_Press' }),
      line({ lineId: 'c', machineType: 'CNC_Mill' }),
    ]);
    expect(m.neighborhoods).toHaveLength(2);
    expect(m.neighborhoods.map((n) => n.machineType).sort()).toEqual(['CNC_Mill', 'Hydraulic_Press']);
    expect(m.neighborhoods.find((n) => n.machineType === 'Hydraulic_Press')!.machineCount).toBe(2);
  });

  it('produces one machine per input line, tagged with type + position', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Grinder' }),
      line({ lineId: 'b', machineType: 'Welding_Cell' }),
    ]);
    expect(m.machines).toHaveLength(2);
    for (const mc of m.machines) {
      expect(typeof mc.x).toBe('number');
      expect(typeof mc.z).toBe('number');
    }
  });

  it('has a human label per neighborhood', () => {
    const m = plantToScene([line({ lineId: 'a', machineType: 'Hydraulic_Press' })]);
    expect(m.neighborhoods[0].label).toBe('Press Shop');
  });

  it('maps riskBand to RISK_BAND_HEX and sets emphasized for critical/elevated only', () => {
    const m = plantToScene([
      line({ lineId: 'c', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'e', machineType: 'Grinder', riskBand: 'elevated' }),
      line({ lineId: 'w', machineType: 'Grinder', riskBand: 'watch' }),
      line({ lineId: 'h', machineType: 'Grinder', riskBand: 'healthy' }),
    ]);
    const by = (id: string) => m.machines.find((x) => x.lineId === id)!;
    expect(by('c').colorHex).toBe(0xe5484d);
    expect(by('h').colorHex).toBe(0x3c6997);
    expect(by('c').emphasized).toBe(true);
    expect(by('e').emphasized).toBe(true);
    expect(by('w').emphasized).toBe(false);
    expect(by('h').emphasized).toBe(false);
  });

  it('picks hero = max exposure, tiebroken by failureRiskScore desc then lineId asc', () => {
    const m = plantToScene([
      line({ lineId: 'LINE-0317', machineType: 'Welding_Cell', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.8 }),
      line({ lineId: 'LINE-0031', machineType: 'Grinder', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
      line({ lineId: 'LINE-0122', machineType: 'Hydraulic_Press', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
    ]);
    expect(m.heroLineId).toBe('LINE-0031');
  });

  it('counts risk bands + per-neighborhood criticalCount', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'b', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'c', machineType: 'Grinder', riskBand: 'watch' }),
    ]);
    expect(m.counts).toMatchObject({ total: 3, critical: 2, watch: 1, healthy: 0, elevated: 0 });
    expect(m.neighborhoods[0].criticalCount).toBe(2);
  });

  it('is stable: same input → identical machine order + positions', () => {
    const lines = [
      line({ lineId: 'L3', machineType: 'CNC_Mill' }),
      line({ lineId: 'L1', machineType: 'CNC_Mill' }),
      line({ lineId: 'L2', machineType: 'Hydraulic_Press' }),
    ];
    const a = plantToScene(lines);
    const b = plantToScene([...lines]);
    expect(a.machines.map((x) => [x.lineId, x.x, x.z])).toEqual(b.machines.map((x) => [x.lineId, x.x, x.z]));
  });

  it('handles an empty plant without throwing', () => {
    const m = plantToScene([]);
    expect(m.neighborhoods).toEqual([]);
    expect(m.machines).toEqual([]);
    expect(m.heroLineId).toBeNull();
    expect(m.counts.total).toBe(0);
  });
});
