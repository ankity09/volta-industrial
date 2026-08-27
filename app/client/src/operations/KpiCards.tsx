/**
 * Three KPI cards at the top of the Plant Floor page:
 * Downtime Exposure, Open Work Orders, Critical Lines.
 *
 * Drives the "live update" demo moment — when the agent executes an action,
 * the KPIs tick down. When `dataMutated` fires, each card's value is compared
 * to the previous and cards that moved pulse a critical-red ring.
 */
import { AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { LinesSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: LinesSummary[] }) {
  let downtimeExposure = 0;
  let openWoCount = 0;
  let criticalCount = 0;

  for (const s of summary) {
    downtimeExposure += s.downtime_exposure_usd;
    if (s.risk_band === 'critical') {
      criticalCount += s.n;
    }
    if (s.risk_band === 'critical' || s.risk_band === 'elevated') {
      openWoCount += s.n;
    }
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="Downtime Exposure"
        value={downtimeExposure}
        unit="usd"
        icon={<Zap className="size-4" />}
        tone="critical"
      />
      <Card
        label="Open Work Orders"
        value={openWoCount}
        unit="count"
        icon={<AlertTriangle className="size-4" />}
        tone="elevated"
      />
      <Card
        label="Critical Lines"
        value={criticalCount}
        unit="count"
        icon={<CheckCircle2 className="size-4" />}
        tone="neutral"
      />
    </div>
  );
}

function Card({
  label,
  value,
  unit,
  icon,
  tone,
}: {
  label: string;
  value: number;
  unit: 'usd' | 'count';
  icon: React.ReactNode;
  tone: 'critical' | 'elevated' | 'neutral';
}) {
  const pulse = usePulseOnChange(value);
  const toneClass =
    tone === 'critical'
      ? 'text-[#E5484D]'
      : tone === 'elevated'
        ? 'text-[#FFB020]'
        : 'text-[#3C6997]';

  const formattedValue =
    unit === 'usd'
      ? new Intl.NumberFormat(undefined, {
          notation: 'compact',
          maximumFractionDigits: 1,
          style: 'currency',
          currency: 'USD',
        }).format(value)
      : value.toLocaleString();

  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 flex flex-col sm:flex-row sm:items-baseline gap-0 sm:gap-2">
        <div className="display text-2xl sm:text-3xl font-semibold text-foreground font-mono">
          {formattedValue}
        </div>
      </div>
    </div>
  );
}
