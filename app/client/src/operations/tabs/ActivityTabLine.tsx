/**
 * Merged timeline of work orders and audit trail for this production line.
 * Combines:
 *   - work_orders[]  (approved maintenance actions)
 *   - audit_trail[]  (approvals, overrides, notes)
 *
 * Sorted newest-first by `createdAt` / `at`. This is the action
 * history on this line — what's been done, who did it, when.
 */
import { useMemo } from 'react';
import {
  CheckCircle2,
  Zap,
  AlertTriangle,
  StickyNote,
} from 'lucide-react';
import type { LineDetail, WorkOrderApp, AuditEntry } from '@/shared/types';
import { WorkOrderStatusBadge } from '@/shared/badges';

type TimelineItem =
  | ({ kind: 'work_order' } & WorkOrderApp)
  | ({ kind: 'audit' } & AuditEntry);

export function ActivityTab({ detail }: { detail: LineDetail }) {
  const items: TimelineItem[] = useMemo(() => {
    const wos = (detail.work_orders ?? []).map((w) => ({
      kind: 'work_order' as const,
      ...w,
    }));
    const audits = (detail.audit_trail ?? []).map((a) => ({
      kind: 'audit' as const,
      ...a,
    }));
    // Merge and sort by timestamp, newest first
    const all = [
      ...wos.map((w) => ({ ...w, ts: w.decidedAt || w.createdAt })),
      ...audits.map((a) => ({ ...a, ts: a.at })),
    ];
    return all.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
  }, [detail]);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground max-w-md">
        Nothing's happened on this line yet. Once the assistant recommends an
        action and it's approved, the work order will show up here.
      </div>
    );
  }

  return (
    <ol className="space-y-3 max-w-3xl">
      {items.map((item, i) => (
        <li key={i}>
          {item.kind === 'work_order' ? (
            <WorkOrderRow wo={item} />
          ) : (
            <AuditRow audit={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

function WorkOrderRow({ wo }: { wo: WorkOrderApp }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-full flex items-center justify-center shrink-0 bg-[#E5484D] text-white">
            <Zap className="size-3.5" />
          </div>
          <div className="text-sm">
            <span className="font-medium capitalize">{wo.actionType.replace(/_/g, ' ')}</span>
          </div>
        </div>
        <WorkOrderStatusBadge status={wo.status} />
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>
          by <span className="font-mono">{wo.approvedBy || 'pending approval'}</span>
        </div>
        <div>
          Downtime avoided:{' '}
          <span className="font-semibold text-foreground">
            ${(wo.predictedDowntimeCostAvoidedUsd / 1000).toFixed(1)}K
          </span>
        </div>
        {wo.draftedWo && (
          <div className="mt-2 p-2 bg-muted/30 rounded text-xs whitespace-pre-wrap">
            {wo.draftedWo}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {fmt(wo.decidedAt || wo.createdAt)}
      </div>
    </div>
  );
}

function AuditRow({ audit }: { audit: AuditEntry }) {
  const { icon, tone, label } = describe(audit.action);
  return (
    <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-start gap-3">
      <div
        className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${tone}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <span className="font-medium">{label}</span>
          {audit.notes && (
            <span className="text-muted-foreground"> · {audit.notes}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {audit.by}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {fmt(audit.at)}
      </div>
    </div>
  );
}

function describe(action: AuditEntry['action']) {
  switch (action.toLowerCase()) {
    case 'approved':
      return {
        icon: <CheckCircle2 className="size-3.5" />,
        tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
        label: 'Approved',
      };
    case 'executed':
      return {
        icon: <CheckCircle2 className="size-3.5" />,
        tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
        label: 'Executed',
      };
    case 'overridden':
      return {
        icon: <AlertTriangle className="size-3.5" />,
        tone: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
        label: 'Overridden',
      };
    default:
      return {
        icon: <StickyNote className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: action,
      };
  }
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
