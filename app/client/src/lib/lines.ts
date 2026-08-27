/**
 * REST helpers for the plant-floor domain (lines / plants / work orders /
 * maintenance recommendations / activity feed).
 *
 * All requests target the Volta Industrial Lakebase-backed API.
 */
import { okOrThrow } from './api';
import type {
  LineStatus,
  LineDetail,
  LinesSummary,
  MaintenanceRecommendation,
  WorkOrderApp,
  Part,
  PlantBucket,
  ActionType,
  ActivityEvent,
} from '@/shared/types';

export async function fetchLines(
  filters: {
    riskBand?: string;
    plant?: string;
    machineType?: string;
    sort?: 'risk' | 'exposure' | 'vibration';
  } = {},
): Promise<LineStatus[]> {
  const qs = new URLSearchParams();
  if (filters.riskBand) qs.set('riskBand', filters.riskBand);
  if (filters.plant) qs.set('plant', filters.plant);
  if (filters.machineType) qs.set('machineType', filters.machineType);
  if (filters.sort) qs.set('sort', filters.sort);
  const res = await okOrThrow(await fetch(`/api/lines?${qs}`), '/api/lines');
  return res.json();
}

export async function fetchLine(id: string): Promise<LineDetail> {
  const res = await okOrThrow(
    await fetch(`/api/lines/${id}`),
    `/api/lines/${id}`,
  );
  return res.json();
}

export async function fetchLinesSummary(): Promise<LinesSummary[]> {
  const res = await okOrThrow(
    await fetch('/api/lines/summary'),
    '/api/lines/summary',
  );
  return res.json();
}

export async function fetchPlantMap(
  filters: { riskBand?: string } = {},
): Promise<PlantBucket[]> {
  const qs = new URLSearchParams();
  if (filters.riskBand) qs.set('riskBand', filters.riskBand);
  const res = await okOrThrow(
    await fetch(`/api/plants/map?${qs}`),
    '/api/plants/map',
  );
  return res.json();
}

export async function fetchMaintenanceRecommendation(
  lineId: string,
): Promise<MaintenanceRecommendation | null> {
  const res = await okOrThrow(
    await fetch(`/api/lines/${encodeURIComponent(lineId)}/recommendation`),
    '/api/lines/.../recommendation',
  );
  return res.json();
}

export async function searchParts(query: string): Promise<Part[]> {
  const qs = new URLSearchParams({ q: query });
  const res = await okOrThrow(
    await fetch(`/api/parts/search?${qs}`),
    '/api/parts/search',
  );
  return res.json();
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const res = await okOrThrow(
    await fetch(`/api/activity/recent?limit=${limit}`),
    '/api/activity/recent',
  );
  return res.json();
}

export async function executeMaintenanceAction(
  lineId: string,
  action: ActionType,
  partId: string | null,
  draftedWo: string,
): Promise<WorkOrderApp> {
  const res = await okOrThrow(
    await fetch(`/api/lines/${lineId}/work-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, partId, draftedWo }),
    }),
    `/api/lines/${lineId}/work-order`,
  );
  return res.json();
}
