/**
 * Small pill-style badges reused across the Plant Floor page + home activity
 * feed. If you add a new status or risk band, update both the type union in
 * shared/types.ts and the colour map here.
 */
import type { RiskBand, WorkOrderStatus } from './types';

export function RiskBandBadge({ band }: { band: RiskBand }) {
  const styles: Record<RiskBand, string> = {
    critical: 'bg-[#E5484D] text-white',
    elevated: 'bg-[#FFB020] text-[#0A0F1C]',
    watch: 'bg-[#3C6997] text-white',
    healthy: 'bg-muted text-foreground',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[band]}`}
    >
      {band}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    pull_now: 'bg-[#E5484D] text-white',
    run_to_shift_end: 'bg-[#3C6997] text-white',
    expedite_parts_and_run: 'bg-[#FFB020] text-[#0A0F1C]',
  };
  const cls = styles[action] ?? 'bg-muted text-muted-foreground';
  const label = action
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const styles: Record<WorkOrderStatus, string> = {
    proposed: 'bg-muted text-foreground',
    approved: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    executed: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    overridden: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
