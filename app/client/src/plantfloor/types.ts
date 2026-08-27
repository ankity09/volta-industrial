export type RiskBand = 'critical' | 'elevated' | 'watch' | 'healthy';

export interface LineStatus {
  lineId: string;
  lineName: string;
  plantId: string;
  machineType: string;
  plantLat?: number;
  plantLng?: number;
  failureRiskScore: number;
  riskBand: RiskBand;
  vibrationRms?: number;
}

export const RISK_BAND_COLORS: Record<RiskBand, string> = {
  critical: '#E5484D',
  elevated: '#FFB020',
  watch: '#FFB020',
  healthy: '#3C6997',
};

export const RISK_BAND_HEX: Record<RiskBand, number> = {
  critical: 0xE5484D,
  elevated: 0xFFB020,
  watch: 0xFFB020,
  healthy: 0x3C6997,
};
