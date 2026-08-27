/**
 * Plant-floor failure risk breakdown with at-risk lines drill-down.
 * Read-only pattern-spotting view for predictive maintenance.
 *
 * Answers: "Where is the failure risk concentrated?"
 *   - Horizontal bar per plant (width = downtime_exposure_usd or critical_lines).
 *   - Click a bar OR pick from the dropdown to select that plant.
 *   - Below: the top at-risk lines at that plant. Each line has an
 *     "Open in Operations ->" link that jumps to the operations view
 *     pre-filtered on that line_id.
 *
 * Data comes from Lakebase (not the warehouse) so this stays fast and
 * reflects agent actions live.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Factory } from 'lucide-react';
import { Link } from 'react-router';
import { Skeleton } from '@databricks/appkit-ui/react';
import { fetchPlantMap, fetchLines } from '@/lib/lines';
import type { PlantBucket, LineStatus } from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { usePulseOnChange } from '@/lib/usePulseOnChange';

export function FacilityPanel() {
  const [plants, setPlants] = useState<PlantBucket[]>([]);
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // Reload plants on mount and every agent write. Cancellation flag
  // covers both paths so a stale response can't overwrite fresh data.
  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchPlantMap()
        .then((rows) => {
          if (cancelled) return;
          setPlants(rows);
          setSelected((curr) => curr ?? rows[0]?.plant_id ?? null);
        })
        .catch((e) => {
          if (cancelled) return;
          console.error('[plant-map] reload failed', e);
        })
        .finally(() => {
          if (!cancelled) setLoadingPlants(false);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Reload the selected plant's at-risk lines on selection change AND on agent
  // writes. The dataMutated refetch is a silent background swap. We only
  // flip `loadingLines` for the user-driven initial fetch (selection change),
  // never on every agent write.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingLines(true);
    function reload() {
      fetchLines({ plant: selected })
        .then((rows) => {
          if (!cancelled) {
            const filtered = rows
              .filter((line) => ['critical', 'elevated', 'watch'].includes(line.riskBand))
              .sort((a, b) => b.downtimeExposureUsd - a.downtimeExposureUsd)
              .slice(0, 8);
            setLines(filtered);
          }
        })
        .catch(() => {
          if (!cancelled) setLines([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingLines(false);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [selected]);

  const max = useMemo(
    () => Math.max(1, ...plants.map((p) => p.downtime_exposure_usd)),
    [plants],
  );

  // Empty after a successful fetch — there's just no data. Hide quietly
  // (this is the "no plants have at-risk lines" case, e.g. healthy fleet).
  if (!loadingPlants && plants.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="display text-xl font-semibold tracking-tight">
            Where is the failure risk concentrated?
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            At-risk lines by plant. Pick a plant to drill into its highest-exposure lines.
          </p>
        </div>
        {loadingPlants ? (
          <Skeleton className="h-8 w-44 shrink-0 bg-muted" />
        ) : (
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
          >
            {plants.map((p) => (
              <option key={p.plant_id} value={p.plant_id}>
                {p.plant_id} . {p.critical_lines} critical
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2.5">
        {loadingPlants ? (
          <div className="space-y-3 py-1">
            {['100%', '85%', '70%', '55%'].map((w) => (
              <Skeleton key={w} className="h-5 bg-muted" style={{ width: w }} />
            ))}
          </div>
        ) : (
          plants.map((p) => (
            <PlantBar
              key={p.plant_id}
              row={p}
              max={max}
              isSelected={p.plant_id === selected}
              onSelect={() => setSelected(p.plant_id)}
            />
          ))
        )}
      </div>

      {(loadingPlants || selected) && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            At-risk lines{selected ? ` - ${selected}` : ''}
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {(loadingPlants || loadingLines) && (
              <div className="p-4 space-y-3">
                {['100%', '100%', '75%'].map((w, i) => (
                  <Skeleton key={i} className="h-4 bg-muted" style={{ width: w }} />
                ))}
              </div>
            )}
            {!loadingPlants && !loadingLines && lines.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No at-risk lines at this plant.
              </div>
            )}
            {!loadingPlants && !loadingLines && lines.map((line) => (
              <div
                key={line.lineId}
                className="px-4 py-3 flex items-center gap-4 border-t first:border-t-0 border-border"
              >
                <div className="font-mono text-sm w-40 shrink-0">
                  {line.lineId}
                </div>
                <div className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
                  {line.machineType}
                </div>
                <div className="text-sm tabular-nums w-28 text-right">
                  {(line.failureRiskScore * 100).toFixed(0)}% risk
                </div>
                <div className="w-24 text-right text-sm text-muted-foreground tabular-nums">
                  ${Number(line.downtimeExposureUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <Link
                  to={`/operations?line=${encodeURIComponent(line.lineId)}`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Operations
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PlantBar({
  row: p,
  max,
  isSelected,
  onSelect,
}: {
  row: PlantBucket;
  max: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // Pulse the bar's row when its downtime_exposure_usd moves between refetches.
  // Same hook every Operations surface uses.
  const pulse = usePulseOnChange(p.downtime_exposure_usd);
  const pct = (p.downtime_exposure_usd / max) * 100;
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left group rounded-md ${
        pulse ? 'animate-pulse-row' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="w-28 shrink-0 flex items-center gap-1.5 text-sm">
          <Factory
            className={`size-3.5 ${
              isSelected ? 'text-foreground' : 'text-muted-foreground'
            }`}
          />
          <span
            className={
              isSelected
                ? 'font-semibold text-foreground'
                : 'text-foreground/80 group-hover:text-foreground'
            }
          >
            {p.plant_id}
          </span>
        </div>
        <div className="flex-1 h-7 rounded-md bg-muted relative overflow-hidden">
          <div
            className="h-full rounded-md transition-all"
            style={{
              width: `${pct}%`,
              background: isSelected
                ? 'var(--primary)'
                : 'color-mix(in oklch, var(--primary) 22%, var(--muted))',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-end pr-2.5 text-xs font-medium text-foreground">
            {p.critical_lines} critical
          </div>
        </div>
        <div className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          ${Number(p.downtime_exposure_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
    </button>
  );
}

