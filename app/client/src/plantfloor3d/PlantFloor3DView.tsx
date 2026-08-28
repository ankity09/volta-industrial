/**
 * Plant Floor 3D v2 — one plant at a time, cinematic factory floor.
 *
 * Owns data + overlay UI and drives the imperative vanilla-Three engine
 * (scene.ts) through its SceneHandle. Renders a SINGLE plant chosen from a
 * required dropdown (PLANT-01 through PLANT-08), showing its ~130-167 lines as
 * detailed neighborhoods of machines, colored by risk. The camera flies in to
 * the top-exposure line on plant select; clicking a machine opens a live
 * Lakebase slide-over (LineDetailPanel). Risk chips dim machines in-scene via
 * highlightRisk. When the agent commits a work order, dataMutated refetches the
 * current plant and recolors in place, closing the loop in 3D.
 *
 * Responsibility: orchestration only. The engine owns pixels (scene.ts); the
 * pure mapper owns geometry math (plant-to-scene.ts); the panel owns detail
 * fetch (LineDetailPanel.tsx). This file wires them and renders overlay chrome.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, X, Plus, Minus, Maximize2, AlertTriangle } from 'lucide-react';
import { fetchLines } from '@/lib/lines';
import { dataMutated } from '@/lib/events';
import { RISK_BAND_COLORS } from '@/plantfloor/types';
import type { LineStatus, RiskBand } from '@/shared/types';
import { createScene } from './scene';
import { plantToScene } from './plant-to-scene';
import { LineDetailPanel } from './LineDetailPanel';
import type { SceneHandle, PlantSceneModel } from './scene.types';

const RISK_LABELS: Record<RiskBand, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  watch: 'Watch',
  healthy: 'Healthy',
};
const RISK_ORDER: RiskBand[] = ['critical', 'elevated', 'watch', 'healthy'];
const PLANTS = ['PLANT-01', 'PLANT-02', 'PLANT-03', 'PLANT-04', 'PLANT-05', 'PLANT-06', 'PLANT-07', 'PLANT-08'];

export function PlantFloor3DView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const selectedPlantRef = useRef('PLANT-01');

  const [handle, setHandle] = useState<SceneHandle | null>(null);
  const [selectedPlant, setSelectedPlant] = useState('PLANT-01');
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [model, setModel] = useState<PlantSceneModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [heroDismissed, setHeroDismissed] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskBand | 'all'>('all');
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

  // Keep selectedPlantRef in sync for the dataMutated subscription below.
  useEffect(() => {
    selectedPlantRef.current = selectedPlant;
  }, [selectedPlant]);

  // --- Per-plant fetch effect: when handle or selectedPlant change, fetch the plant's lines. ---
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;

    let cancelled = false;
    // Fly-in timer lives at effect scope so the effect cleanup can clear it.
    // (Returning a cleanup from inside .then() does not work — the promise
    // discards it, so a rapid plant switch would leave a stale timer firing a
    // focusLine on the previous plant's hero.)
    let flyTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    fetchLines({ plant: selectedPlant })
      .then((fetchedLines) => {
        if (cancelled) return;
        setLines(fetchedLines);
        const m = plantToScene(fetchedLines);
        setModel(m);
        h.setPlant(m);
        setHeroDismissed(false);
        setError(null);

        // Fly-in to the hero line (re-runs on every plant switch).
        if (m.heroLineId) {
          const heroId = m.heroLineId;
          flyTimer = setTimeout(
            () => {
              handleRef.current?.focusLine(heroId);
            },
            reduced ? 0 : 900,
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (flyTimer) clearTimeout(flyTimer);
    };
  }, [handle, selectedPlant, reduced]);

  // --- Live loop: the agent commits a work order -> dataMutated -> refetch current plant.
  // Reads the latest plant via selectedPlantRef, so this subscribes once with no stale closure.
  // Recolor only (no focusLine re-fly on a refetch). ---
  useEffect(() => {
    const unsub = dataMutated.subscribe(() => {
      fetchLines({ plant: selectedPlantRef.current })
        .then((fetchedLines) => {
          setLines(fetchedLines);
          const m = plantToScene(fetchedLines);
          setModel(m);
          handleRef.current?.setPlant(m);
        })
        .catch(() => {
          /* keep the prior frame on a transient refetch error */
        });
    });
    return unsub;
  }, []);

  // --- Risk highlighting: call highlightRisk whenever riskFilter changes. ---
  useEffect(() => {
    if (riskFilter === 'all') {
      handleRef.current?.highlightRisk('all');
    } else {
      handleRef.current?.highlightRisk(riskFilter);
    }
  }, [riskFilter]);

  // The hero card is per-plant and always meaningful for the selected plant,
  // shown until the user dismisses it.
  const heroLine = useMemo(
    () =>
      model?.heroLineId
        ? (lines.find((l) => l.lineId === model.heroLineId) ?? null)
        : null,
    [model, lines],
  );

  function runSearch() {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = lines.find(
      (l) =>
        l.lineId.toLowerCase() === q ||
        l.lineId.toLowerCase().includes(q) ||
        l.lineName.toLowerCase().includes(q),
    );
    if (match) {
      handleRef.current?.focusLine(match.lineId);
      setSelectedId(match.lineId);
    }
  }

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0A0F1C]">
      {/* WebGL + CSS2D mount */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Initial loading skeleton (over the still-empty canvas). */}
      {loading && lines.length === 0 && (
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

      {/* Top-left: plant selector (required primary nav) + risk filter chips + search. */}
      <div className="absolute top-4 left-4 flex flex-col gap-3 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <label htmlFor="plant-select" className="text-xs font-medium text-muted-foreground">
            Plant
          </label>
          <select
            id="plant-select"
            value={selectedPlant}
            onChange={(e) => setSelectedPlant(e.target.value)}
            className="h-8 rounded-md border border-border bg-card/90 backdrop-blur px-2.5 text-xs font-medium text-foreground"
          >
            {PLANTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
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
        <div className="flex items-center gap-1.5 h-8 rounded-md border border-border bg-card/90 backdrop-blur px-2 pointer-events-auto">
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

      {/* Per-plant hero card. Shown until dismissed. */}
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

      {/* Navigator: the "I'm lost / get me somewhere" controls. Reset re-frames
          the whole plant; +/- zoom works even where wheel/trackpad is flaky;
          Next critical flies through the plant's critical lines. */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        <button
          onClick={() => handleRef.current?.focusNextCritical()}
          disabled={!model || model.counts.critical === 0}
          className="flex items-center gap-2 h-9 rounded-lg border border-border bg-card/90 backdrop-blur px-3 text-xs font-medium text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Fly to the next critical line"
        >
          <AlertTriangle className="size-3.5 text-[#E5484D]" />
          Next critical
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRef.current?.resetView()}
            className="flex items-center gap-2 h-9 rounded-lg border border-border bg-card/90 backdrop-blur px-3 text-xs font-medium text-foreground hover:border-foreground/30 transition-colors"
            title="Reset the view to the whole plant"
          >
            <Maximize2 className="size-3.5" />
            Reset view
          </button>
          <div className="flex items-center rounded-lg border border-border bg-card/90 backdrop-blur overflow-hidden">
            <button
              onClick={() => handleRef.current?.zoomBy(0.8)}
              className="grid place-items-center size-9 text-foreground hover:bg-muted transition-colors"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus className="size-4" />
            </button>
            <div className="w-px self-stretch bg-border" />
            <button
              onClick={() => handleRef.current?.zoomBy(1.25)}
              className="grid place-items-center size-9 text-foreground hover:bg-muted transition-colors"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Orbit hint. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground/70 pointer-events-none">
        Drag to orbit, use the controls to zoom or reset, click a line for detail
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
