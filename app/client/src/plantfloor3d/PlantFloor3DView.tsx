/**
 * Plant Floor 3D — the full-screen wow-factor tab.
 *
 * Owns data + overlay UI and drives the imperative vanilla-Three engine
 * (scene.ts) through its SceneHandle. All ~1,200 lines from GET /api/lines
 * render as InstancedMesh cabinets across 8 plant bays, colored by risk; the
 * camera flies in to the top-exposure critical line on load; clicking a
 * cabinet opens a live Lakebase slide-over that bridges into the chat dock
 * (Assist) and the Operations drawer (Act). When the agent commits a work
 * order, the existing dataMutated bus refetches and recolors the floor in
 * place, closing the loop in 3D.
 *
 * Responsibility: orchestration only. The engine owns pixels (scene.ts); the
 * mapping owns geometry math (lines-to-scene.ts); the panel owns the detail
 * fetch (LineDetailPanel.tsx). This file wires them and renders the overlay.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, X } from 'lucide-react';
import { fetchLines, fetchLinesSummary } from '@/lib/lines';
import { dataMutated } from '@/lib/events';
import { RISK_BAND_COLORS } from '@/plantfloor/types';
import type { LineStatus, RiskBand } from '@/shared/types';
import { createScene } from './scene';
import { linesToScene } from './lines-to-scene';
import { LineDetailPanel } from './LineDetailPanel';
import type { SceneHandle, SceneModel } from './scene.types';

const RISK_LABELS: Record<RiskBand, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  watch: 'Watch',
  healthy: 'Healthy',
};
const RISK_ORDER: RiskBand[] = ['critical', 'elevated', 'watch', 'healthy'];

export function PlantFloor3DView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const didFocusRef = useRef(false);

  const [handle, setHandle] = useState<SceneHandle | null>(null);
  const [allLines, setAllLines] = useState<LineStatus[]>([]);
  const [model, setModel] = useState<SceneModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [heroDismissed, setHeroDismissed] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskBand | 'all'>('all');
  const [plantFilter, setPlantFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read the reduced-motion preference once; the engine skips bloom + ambient
  // pulse and snaps the camera instead of tweening when this is true.
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  // --- Mount the scene once. dispose() must fully tear down (StrictMode
  // double-invokes this effect in dev, and the route is lazy). ---
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const h = createScene(el, { reducedMotion: reduced });
    h.onSelect(({ lineId }) => setSelectedId(lineId));
    handleRef.current = h;
    setHandle(h);

    const ro = new ResizeObserver(() => h.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      h.dispose();
      handleRef.current = null;
      setHandle(null);
    };
  }, [reduced]);

  // --- Initial fetch: all 1,200 lines (unfiltered) + the summary. ---
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchLines({}), fetchLinesSummary()])
      .then(([lines]) => {
        if (cancelled) return;
        setAllLines(lines);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Live loop: the agent commits a work order -> dataMutated -> refetch.
  // Reads the latest handle via ref, so this subscribes once with no stale
  // closure. Recolor only (setAllLines drives the derived effect below); we
  // deliberately do NOT re-run the fly-in here. ---
  useEffect(() => {
    const unsub = dataMutated.subscribe(() => {
      fetchLines({})
        .then((lines) => setAllLines(lines))
        .catch(() => {
          /* keep the prior frame on a transient refetch error */
        });
    });
    return unsub;
  }, []);

  // --- Derived: (allLines + filters) -> SceneModel -> scene. Single source of
  // truth; the live loop and filter changes both flow through here. The
  // one-time fly-in to the hero fires the first time data lands. ---
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    const filtered = allLines.filter(
      (l) =>
        (riskFilter === 'all' || l.riskBand === riskFilter) &&
        (plantFilter === null || l.plantId === plantFilter),
    );
    const m = linesToScene(filtered);
    setModel(m);
    h.setLines(m);

    if (!didFocusRef.current && m.heroLineId) {
      didFocusRef.current = true;
      const heroId = m.heroLineId;
      const timer = setTimeout(
        () => handleRef.current?.focusLine(heroId),
        reduced ? 0 : 900,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [allLines, riskFilter, plantFilter, handle, reduced]);

  const plantIds = useMemo(
    () => [...new Set(allLines.map((l) => l.plantId))].sort(),
    [allLines],
  );

  const heroLine = useMemo(
    () =>
      model?.heroLineId
        ? (allLines.find((l) => l.lineId === model.heroLineId) ?? null)
        : null,
    [model, allLines],
  );

  function runSearch() {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = allLines.find(
      (l) =>
        l.lineId.toLowerCase() === q ||
        l.lineId.toLowerCase().includes(q) ||
        l.lineName.toLowerCase().includes(q),
    );
    if (match) {
      handleRef.current?.focusLine(match.lineId);
      setSelectedId(match.lineId); // keyboard-accessible selection path
    }
  }

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0A0F1C]">
      {/* WebGL + CSS2D mount */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Initial loading skeleton (over the still-empty canvas). */}
      {loading && allLines.length === 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Boxes className="size-8 animate-pulse" />
            <div className="text-sm">Loading plant floor…</div>
          </div>
        </div>
      )}

      {/* Fetch error card. */}
      {error && (
        <div className="absolute inset-0 grid place-items-center px-4">
          <div className="max-w-md rounded-xl border border-border bg-card px-6 py-5 text-center">
            <div className="text-sm font-semibold text-foreground mb-1">
              Could not load the plant floor
            </div>
            <div className="text-xs text-muted-foreground break-words">{error}</div>
          </div>
        </div>
      )}

      {/* Top-left: filters + search. Only the controls take pointer events. */}
      <div className="absolute top-4 left-4 flex flex-col gap-3 pointer-events-none">
        <div className="flex flex-wrap gap-1.5 pointer-events-auto">
          <FilterChip
            label="All"
            active={riskFilter === 'all'}
            onClick={() => setRiskFilter('all')}
          />
          {RISK_ORDER.map((band) => (
            <FilterChip
              key={band}
              label={RISK_LABELS[band]}
              color={RISK_BAND_COLORS[band]}
              active={riskFilter === band}
              onClick={() => setRiskFilter(band)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <select
            value={plantFilter ?? ''}
            onChange={(e) => setPlantFilter(e.target.value || null)}
            className="h-8 rounded-md border border-border bg-card/90 backdrop-blur px-2 text-xs text-foreground"
            aria-label="Filter by plant"
          >
            <option value="">All plants</option>
            {plantIds.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 h-8 rounded-md border border-border bg-card/90 backdrop-blur px-2">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch();
              }}
              placeholder="Find a line, then Enter"
              className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-40"
              aria-label="Search a line to focus"
            />
          </div>
        </div>
      </div>

      {/* On-load hero risk card. Gated on heroDismissed so a later filter or
          refetch does not make it reappear or flash. */}
      {heroLine && !heroDismissed && (
        <div className="absolute top-4 right-4 w-[300px] rounded-xl border border-[#E5484D]/50 bg-card/95 backdrop-blur shadow-xl pointer-events-auto">
          <div className="flex items-start justify-between px-4 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#E5484D]">
              Highest exposure line
            </div>
            <button
              onClick={() => setHeroDismissed(true)}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="px-4 pb-4 pt-1">
            <div className="text-base font-semibold text-foreground">
              {heroLine.lineName || heroLine.lineId}
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              {heroLine.plantId}, {heroLine.machineType}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">Failure risk</div>
                <div className="text-sm font-mono font-semibold text-foreground">
                  {(heroLine.failureRiskScore * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Exposure</div>
                <div className="text-sm font-mono font-semibold text-foreground">
                  ${(heroLine.downtimeExposureUsd / 1000).toFixed(1)}K
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-muted-foreground">Part</div>
                <div className="text-sm font-semibold text-foreground">
                  {heroLine.partLocal ? 'Local stock' : 'Not local'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedId(heroLine.lineId)}
              className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: '#E5484D' }}
            >
              Inspect this line
            </button>
          </div>
        </div>
      )}

      {/* Bottom-left legend (risk band counts). */}
      {model && (
        <div className="absolute bottom-4 left-4 rounded-xl border border-border bg-card/90 backdrop-blur px-4 py-3 pointer-events-none">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Risk bands
          </div>
          <div className="flex flex-col gap-1.5">
            {RISK_ORDER.map((band) => (
              <div key={band} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2.5 rounded-sm shrink-0"
                  style={{ background: RISK_BAND_COLORS[band] }}
                />
                <span className="text-foreground">{RISK_LABELS[band]}</span>
                <span className="ml-auto pl-4 font-mono text-muted-foreground tabular-nums">
                  {model.counts[band]}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-xs mt-1 pt-1.5 border-t border-border">
              <span className="text-muted-foreground">Total lines</span>
              <span className="ml-auto pl-4 font-mono text-foreground tabular-nums">
                {model.counts.total}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Orbit hint. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground/70 pointer-events-none">
        Drag to orbit, scroll to zoom, click a line for detail
      </div>

      <LineDetailPanel lineId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 h-8 rounded-md border px-2.5 text-xs font-medium transition-colors backdrop-blur ${
        active
          ? 'border-foreground/40 bg-card text-foreground'
          : 'border-border bg-card/70 text-muted-foreground hover:text-foreground'
      }`}
    >
      {color && (
        <span
          className="size-2.5 rounded-sm shrink-0"
          style={{ background: color }}
        />
      )}
      {label}
    </button>
  );
}
