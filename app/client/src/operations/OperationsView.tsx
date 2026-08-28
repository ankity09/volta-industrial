/**
 * The Plant Floor page — the WRITE SURFACE for the predictive-maintenance use case.
 *
 * This page renders the at-risk line queue from Lakebase (live, writable,
 * transactional) and stays in sync with the agent's actions via the
 * `dataMutated` pub/sub. When the chat stream completes and the agent writes
 * a work order, the queue refetches so you literally WATCH the agent's writes
 * land here live.
 *
 * Responsibility: orchestration only — owns filter/selection state, fetches
 * data, subscribes to `dataMutated`. Sub-components render the pieces:
 *
 *    KpiCards       — Downtime exposure / Open work orders / Critical lines
 *    PlantFloor3D   — 3D visualization of the plant floor (lazy-loaded)
 *    LinesTable     — filterable at-risk queue, click a row to open the drawer
 *    LineDrawer     — slide-over with tabs (Line / Recommendation / Activity)
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { fetchLines, fetchLinesSummary } from '@/lib/lines';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type { LineStatus, LinesSummary, RiskBand } from '@/shared/types';

import { KpiCards } from './KpiCards';
import { LinesTable } from './LinesTable';
import { LineDrawer } from './LineDrawer';
import { IngestionFlow } from '@/architecture/IngestionFlow';

// Lazy-load the 3D plant floor component; if it doesn't exist yet,
// fallback gracefully so the build doesn't break.
const PlantFloor3D = lazy(() =>
  import('../plantfloor/PlantFloor3D').then((m) => ({ default: m.PlantFloor3D })),
);

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Normalize a missing/empty ?line= to null. If this is '' the drawer's
  // `open={selectedId !== null}` is true on load ('' !== null), so the
  // slide-over opens with no id — no fetch fires, and it renders blank.
  const lineFromUrl = searchParams.get('line') || null;

  const [riskFilter, setRiskFilter] = useState<RiskBand | 'all'>(
    (searchParams.get('risk') as RiskBand | null) ?? 'critical',
  );
  const [plantFilter, setPlantFilter] = useState<string | null>(
    searchParams.get('plant') ?? null,
  );
  const [machineFilter, setMachineFilter] = useState<string | null>(
    searchParams.get('machine') ?? null,
  );
  const [sort, setSort] = useState<'risk' | 'exposure' | 'vibration'>(
    (searchParams.get('sort') as 'risk' | 'exposure' | 'vibration') ?? 'exposure',
  );
  const [search, setSearch] = useState('');

  // Sync all queue filters → URL so deep links + back/forward work.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('risk', riskFilter === 'all' ? null : riskFilter);
    setOrDelete('plant', plantFilter);
    setOrDelete('machine', machineFilter);
    setOrDelete('sort', sort === 'exposure' ? null : sort);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskFilter, plantFilter, machineFilter, sort]);

  // Update state when URL changes (e.g. user clicks a link from Analytics).
  useEffect(() => {
    const urlRisk = (searchParams.get('risk') as RiskBand | null) ?? 'critical';
    if (urlRisk !== riskFilter) setRiskFilter(urlRisk);
    const urlPlant = searchParams.get('plant');
    if (urlPlant !== plantFilter) setPlantFilter(urlPlant);
    const urlMachine = searchParams.get('machine');
    if (urlMachine !== machineFilter) setMachineFilter(urlMachine);
    const urlSort = (searchParams.get('sort') as 'risk' | 'exposure' | 'vibration' | null) ?? 'exposure';
    if (urlSort !== sort) setSort(urlSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [rows, setRows] = useState<LineStatus[]>([]);
  const [summary, setSummary] = useState<LinesSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(lineFromUrl);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchLines({
          riskBand: riskFilter === 'all' ? undefined : riskFilter,
          plant: plantFilter ?? undefined,
          machineType: machineFilter ?? undefined,
          sort,
        }),
        fetchLinesSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskFilter, plantFilter, machineFilter, sort]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskFilter, plantFilter, machineFilter, sort]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.lineId.toLowerCase().includes(q) ||
        r.lineName.toLowerCase().includes(q) ||
        r.plantId.toLowerCase().includes(q) ||
        r.machineType.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        {/* Title + situation + CTA stack on the LEFT; the IngestionFlow
            sits on the RIGHT spanning the full left stack — denser open
            for the Plant Floor page. Stacks under the title on smaller
            screens. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 lg:items-end">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Plant Floor — at-risk lines
              </div>
              <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
                Work the at-risk lines.
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Every red line is trending toward an unplanned stop. Each stop costs
              $22K an hour. Catch it before the shift ends and rank the best action.
            </p>
            {config?.assistantScript?.[0] && (
              <button
                onClick={() =>
                  dockController.openAndSend(config.assistantScript[0].prompt)
                }
                className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: '#E5484D',
                    color: 'white',
                  }}
                >
                  <Sparkles className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Ask the assistant
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">
                    Why is LINE-04 trending to a stop?
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            )}
          </div>
          <IngestionFlow />
        </div>

        <KpiCards summary={summary} />

        {/* 3D Plant Floor visualization (lazy-loaded with fallback) */}
        <Suspense fallback={<div className="h-64 bg-muted rounded-xl animate-pulse" />}>
          <PlantFloor3D lines={rows} onSelectLine={setSelectedId} />
        </Suspense>

        <LinesTable
          rows={filteredRows}
          loading={loading}
          error={error}
          riskFilter={riskFilter}
          onRiskFilter={setRiskFilter}
          search={search}
          onSearch={setSearch}
          plantFilter={plantFilter}
          onPlantFilter={setPlantFilter}
          machineFilter={machineFilter}
          onMachineFilter={setMachineFilter}
          sort={sort}
          onSortChange={setSort}
          onSelect={setSelectedId}
        />
      </div>

      <LineDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => {
          setSelectedId(null);
          void reload();
        }}
      />
    </div>
  );
}
