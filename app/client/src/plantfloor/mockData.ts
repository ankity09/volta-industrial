import { LineStatus, RiskBand } from './types';

function getRandomRiskBand(): RiskBand {
  const rand = Math.random();
  if (rand < 0.05) return 'critical';
  if (rand < 0.15) return 'elevated';
  if (rand < 0.25) return 'watch';
  return 'healthy';
}

export function generateMockLines(count: number = 1200): LineStatus[] {
  const plants = ['PLANT-01', 'PLANT-02', 'PLANT-03', 'PLANT-04', 'PLANT-05', 'PLANT-06', 'PLANT-07', 'PLANT-08'];
  const machineTypes = ['Press', 'Lathe', 'Furnace', 'Conveyor', 'Welder', 'Mill', 'Grinder', 'Assembly'];

  const lines: LineStatus[] = [];

  for (let i = 0; i < count; i++) {
    const plant = plants[Math.floor(Math.random() * plants.length)];
    const plantIdx = plants.indexOf(plant);
    const riskBand = i === count - 100 ? 'critical' : getRandomRiskBand();

    lines.push({
      lineId: `LINE-${String(i + 1).padStart(5, '0')}`,
      lineName: `Production Line ${i + 1}`,
      plantId: plant,
      machineType: machineTypes[Math.floor(Math.random() * machineTypes.length)],
      plantLat: 40.7128 + Math.random() * 0.1 - 0.05,
      plantLng: -74.006 + Math.random() * 0.1 - 0.05,
      failureRiskScore: riskBand === 'critical' ? Math.random() * 0.5 + 0.5 : riskBand === 'elevated' ? Math.random() * 0.3 + 0.25 : riskBand === 'watch' ? Math.random() * 0.2 + 0.15 : Math.random() * 0.15,
      riskBand,
      vibrationRms: riskBand === 'critical' ? Math.random() * 2 + 3 : riskBand === 'elevated' ? Math.random() * 1 + 1.5 : riskBand === 'watch' ? Math.random() * 0.5 + 0.8 : Math.random() * 0.5,
    });
  }

  return lines;
}

export function getMockHeroLineData(): LineStatus {
  return {
    lineId: 'LINE-04',
    lineName: 'Stamping Press 04',
    plantId: 'PLANT-03',
    machineType: 'Press',
    plantLat: 40.7128,
    plantLng: -74.006,
    failureRiskScore: 0.73,
    riskBand: 'critical',
    vibrationRms: 4.2,
  };
}
