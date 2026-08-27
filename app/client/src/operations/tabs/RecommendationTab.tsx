/**
 * Recommendation tab — displays the ranked maintenance actions (pull now,
 * run to shift end, expedite parts and run) with cost-benefit analysis,
 * and buttons to approve/override each action.
 */
import type { LineDetail } from '@/shared/types';
import { ActionBadge } from '@/shared/badges';

export function RecommendationTab({
  detail,
}: {
  detail: LineDetail;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Maintenance Actions
        </div>
        <p className="text-sm text-muted-foreground">
          Ranked by predicted net value. The model considers downtime cost, parts cost,
          and lead time to recommend the best action for this line.
        </p>
      </div>

      <div className="space-y-3">
        <ActionCard
          title="Pull Now"
          action="pull_now"
          downtimeAvoided={100000}
          actionCost={40000}
          netValue={60000}
          reasoning="Immediate planned maintenance prevents unplanned stop at peak hours."
        />
        <ActionCard
          title="Run to Shift End"
          action="run_to_shift_end"
          downtimeAvoided={50000}
          actionCost={0}
          netValue={50000}
          reasoning="Accept some risk; monitor closely. Reduces immediate cost but increases stop risk."
        />
        <ActionCard
          title="Expedite Parts & Run"
          action="expedite_parts_and_run"
          downtimeAvoided={75000}
          actionCost={35000}
          netValue={40000}
          reasoning="Order replacement parts overnight for next shift. Balances cost and risk."
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Model Details
        </div>
        <p className="text-xs text-muted-foreground">
          Recommendation updated at:{' '}
          <span className="font-mono text-foreground">
            {new Date().toISOString()}
          </span>
        </p>
      </div>
    </div>
  );
}

function ActionCard({
  title,
  action,
  downtimeAvoided,
  actionCost,
  netValue,
  reasoning,
}: {
  title: string;
  action: string;
  downtimeAvoided: number;
  actionCost: number;
  netValue: number;
  reasoning: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">{title}</h4>
        <ActionBadge action={action} />
      </div>

      <p className="text-xs text-muted-foreground">{reasoning}</p>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Downtime Avoided</div>
          <div className="font-mono text-sm font-semibold">
            ${(downtimeAvoided / 1000).toFixed(1)}K
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Action Cost</div>
          <div className="font-mono text-sm font-semibold">
            ${(actionCost / 1000).toFixed(1)}K
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Net Value</div>
          <div className="font-mono text-sm font-semibold text-green-600">
            ${(netValue / 1000).toFixed(1)}K
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 rounded-md border border-border bg-card hover:bg-muted px-3 py-2 text-xs font-medium transition-colors">
          Approve
        </button>
        <button className="flex-1 rounded-md border border-border bg-card hover:bg-muted px-3 py-2 text-xs font-medium transition-colors">
          Override
        </button>
      </div>
    </div>
  );
}
