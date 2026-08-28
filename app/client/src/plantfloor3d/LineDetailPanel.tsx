/**
 * Live-data slide-over panel for the Plant Floor 3D tab.
 * Opens when a line is selected in the 3D visualization.
 * Fetches LineDetail from Lakebase and displays a stat card + two CTAs.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { fetchLine } from '@/lib/lines';
import { dockController } from '@/chat/dockController';
import { RiskBandBadge } from '@/shared/badges';
import type { LineDetail } from '@/shared/types';

type Props = {
  lineId: string | null;
  onClose: () => void;
};

export function LineDetailPanel({ lineId, onClose }: Props) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lineId) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchLine(lineId)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [lineId]);

  const isOpen = lineId !== null;

  return (
    <div
      className={`fixed right-0 top-14 bottom-0 w-[380px] bg-card border-l border-border z-30 shadow-xl transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {detail && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <RiskBandBadge band={detail.risk_band} />
                <span className="text-xs text-muted-foreground font-mono">
                  {detail.plant_id}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-foreground truncate">
                {detail.line_name || detail.line_id}
              </h2>
            </>
          )}
          {loading && (
            <div className="space-y-2">
              <div className="h-5 bg-muted rounded w-3/4 animate-pulse" />
              <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-2 p-1 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Loading skeleton */}
        {loading && !detail && (
          <div className="space-y-4">
            {/* Stat grid skeleton */}
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
                  <div className="h-5 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
            {/* CTA skeleton */}
            <div className="space-y-2 mt-6">
              <div className="h-10 bg-muted rounded-lg animate-pulse" />
              <div className="h-10 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {/* Stat grid */}
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Failure risk */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Failure risk
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {(detail.failure_risk_score * 100).toFixed(0)}%
                </div>
              </div>

              {/* Downtime exposure */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Downtime exposure
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  ${(detail.downtime_exposure_usd / 1000).toFixed(1)}K
                </div>
              </div>

              {/* Vibration */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Vibration
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {detail.vibration_rms.toFixed(2)} mm/s
                </div>
              </div>

              {/* Temperature */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Temperature
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {detail.temperature_c.toFixed(1)} °C
                </div>
              </div>

              {/* Open work orders */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Open work orders
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {detail.open_wo_count}
                </div>
              </div>

              {/* Part */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Part
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {detail.part_local
                    ? 'Local'
                    : detail.part_lead_time_days
                      ? `Lead time ${detail.part_lead_time_days}d`
                      : 'n/a'}
                </div>
              </div>

              {/* Machine type (spans both columns for reference) */}
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground mb-1">
                  Machine type
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {detail.machine_type}
                </div>
              </div>
            </div>

            {/* CTAs */}
            <div className="space-y-3 mt-8 pt-4 border-t border-border">
              {/* Ask the assistant CTA */}
              <button
                onClick={() =>
                  dockController.openAndSend(
                    `${detail.line_name} (${detail.line_id}) is trending toward a stop. Pull it now or run it to the end of the shift?`,
                  )
                }
                className="w-full px-4 py-3 rounded-lg font-medium text-sm text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                style={{ background: '#E5484D' }}
              >
                Ask the assistant about this line
              </button>

              {/* Open in Operations CTA */}
              <button
                onClick={() =>
                  navigate(`/operations?line=${encodeURIComponent(detail.line_id)}`)
                }
                className="w-full px-4 py-3 rounded-lg font-medium text-sm border border-border bg-card text-foreground hover:border-foreground/30 hover:bg-muted transition-colors"
              >
                Open in Operations
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
