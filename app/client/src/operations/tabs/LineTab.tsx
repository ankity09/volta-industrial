/**
 * Line details tab — shows the production line's current telemetry, parts status,
 * criticality, and at-a-glance health metrics.
 */
import type { LineDetail } from '@/shared/types';

export function LineTab({
  detail,
  onMutated,
}: {
  detail: LineDetail;
  onMutated: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Telemetry
        </div>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Vibration RMS" value={detail.vibration_rms.toFixed(2)} unit="g" />
          <DetailRow label="Temperature" value={detail.temperature_c.toFixed(1)} unit="°C" />
          <DetailRow
            label="Utilization"
            value={detail.utilization_pct.toFixed(0)}
            unit="%"
          />
          <DetailRow
            label="Failure Risk"
            value={(detail.failure_risk_score * 100).toFixed(0)}
            unit="%"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Status
        </div>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow
            label="Criticality"
            value={detail.criticality}
            variant="text"
          />
          <DetailRow
            label="Open Work Orders"
            value={detail.open_wo_count.toString()}
            variant="text"
          />
          <DetailRow
            label="Has Corrective WO"
            value={detail.has_open_corrective ? 'Yes' : 'No'}
            variant="text"
          />
          <DetailRow
            label="Risk Signal Score"
            value={(detail.risk_signal_score ?? 0).toFixed(2)}
            variant="text"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Parts
        </div>
        {detail.candidate_part_id ? (
          <div className="grid grid-cols-2 gap-4">
            <DetailRow
              label="Part ID"
              value={detail.candidate_part_id}
              variant="text"
              code
            />
            <DetailRow
              label="Local Stock"
              value={detail.part_local ? 'Yes' : 'No'}
              variant="text"
            />
            {detail.part_unit_cost_usd !== null && (
              <DetailRow
                label="Unit Cost"
                value={`$${detail.part_unit_cost_usd}`}
                variant="text"
              />
            )}
            {detail.part_lead_time_days !== null && (
              <DetailRow
                label="Lead Time"
                value={`${detail.part_lead_time_days} days`}
                variant="text"
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No replacement part identified.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Business Impact
        </div>
        <DetailRow
          label="Downtime Exposure"
          value={`$${(detail.downtime_exposure_usd / 1000).toFixed(1)}K`}
          variant="currency"
        />
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  unit,
  variant = 'value',
  code = false,
}: {
  label: string;
  value: string;
  unit?: string;
  variant?: 'value' | 'text' | 'currency';
  code?: boolean;
}) {
  const fontClass = code ? 'font-mono text-xs' : 'text-sm';

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className={`font-semibold text-foreground ${fontClass}`}>
        {value}
        {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
      </div>
    </div>
  );
}
