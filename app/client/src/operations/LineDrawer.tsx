/**
 * Right-side drawer with three tabs for line details. Opens when the user
 * clicks a row in the lines table. Auto-refreshes on dataMutated so when
 * the assistant executes a work order, this view reflects it live.
 */
import { useEffect, useState } from 'react';
import { Activity, Zap } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { fetchLine } from '@/lib/lines';
import { dataMutated } from '@/lib/events';
import { RiskBandBadge } from '@/shared/badges';
import type { LineDetail } from '@/shared/types';

import { LineTab } from './tabs/LineTab';
import { RecommendationTab } from './tabs/RecommendationTab';
import { ActivityTab } from './tabs/ActivityTabLine';

type Props = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
};

export function LineDrawer({ id, open, onOpenChange, onMutated }: Props) {
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetchLine(id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    const unsub = dataMutated.subscribe(() => {
      if (id) void fetchLine(id).then(setDetail).catch(() => {});
    });
    return unsub;
  }, [id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[640px] lg:!max-w-[640px] p-0 flex flex-col"
      >
        {!detail && loading && (
          <div className="p-8 text-muted-foreground">Loading…</div>
        )}
        {error && <div className="p-8 text-destructive">{error}</div>}
        {/* Empty-state guard: if the drawer is open but there's no id/detail,
            no error, and nothing loading, the three branches below would all
            fall through and render a BLANK sheet. Show a hint instead so the
            slide-over is never empty. */}
        {!detail && !loading && !error && (
          <div className="p-8 text-muted-foreground">
            Select a line from the queue to see its detail.
          </div>
        )}
        {detail && (
          <>
            <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <RiskBandBadge band={detail.risk_band} />
                <span className="font-mono text-xs text-muted-foreground">
                  {detail.plant_id}
                </span>
                <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Zap className="size-3" /> {detail.machine_type}
                </span>
              </div>
              <SheetTitle className="display text-2xl">
                {detail.line_name || detail.line_id}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span>Failure Risk: {(detail.failure_risk_score * 100).toFixed(0)}%</span>
                <span className="text-muted-foreground">·</span>
                <span>Vibration: {detail.vibration_rms.toFixed(2)}</span>
                <span className="text-muted-foreground">·</span>
                <span>${(detail.downtime_exposure_usd / 1000).toFixed(1)}K exposure</span>
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="line" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-8 mt-4 w-fit">
                <TabsTrigger value="line">Line</TabsTrigger>
                <TabsTrigger value="recommendation">
                  Recommendation
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <Activity className="size-3.5 mr-1" />
                  Activity
                  {detail.work_orders.length + detail.audit_trail.length > 0 &&
                    `(${detail.work_orders.length + detail.audit_trail.length})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="line"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <LineTab detail={detail} onMutated={onMutated} />
              </TabsContent>
              <TabsContent
                value="recommendation"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <RecommendationTab detail={detail} />
              </TabsContent>
              <TabsContent
                value="activity"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <ActivityTab detail={detail} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
