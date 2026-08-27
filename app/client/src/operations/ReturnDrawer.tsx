/**
 * Right-side subscriber drawer with tabs. Opens when the user clicks a row in
 * the care-desk queue. Auto-refreshes on dataMutated (so when the assistant
 * records a retention action or a care lead approves an offer, this view
 * reflects it live).
 */
import { useEffect, useState } from 'react';
import { Activity, MapPin } from 'lucide-react';
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
import { fetchSubscriber } from '@/lib/caredesk';
import { dataMutated } from '@/lib/events';
import { RiskBadge, ReasonBadge } from '@/shared/badges';
import type { SubscriberDetail } from '@/shared/types';

import { ReturnTab } from './tabs/ReturnTab';
import { CustomerTab } from './tabs/CustomerTab';
import { ActivityTab } from './tabs/ActivityTab';

type Props = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
};

export function ReturnDrawer({ id, open, onOpenChange, onMutated }: Props) {
  const [detail, setDetail] = useState<SubscriberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchSubscriber(id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    const unsub = dataMutated.subscribe(() => {
      if (id) void fetchSubscriber(id).then(setDetail).catch(() => {});
    });
    return unsub;
  }, [id]);

  const actionCount = detail?.actions.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[640px] lg:!max-w-[640px] p-0 flex flex-col"
      >
        {!detail && loading && <div className="p-8 text-muted-foreground">Loading…</div>}
        {error && <div className="p-8 text-destructive">{error}</div>}
        {detail && (
          <>
            <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <RiskBadge band={detail.risk_band} />
                {detail.churn_reason && <ReasonBadge reason={detail.churn_reason} />}
                {detail.home_metro && (
                  <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1">
                    <MapPin className="size-3" /> {detail.home_metro}
                  </span>
                )}
              </div>
              <SheetTitle className="display text-2xl font-mono">
                {detail.subscriber_id}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span className="capitalize">{detail.plan_type ?? '—'} plan</span>
                {detail.tenure_months !== null && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{detail.tenure_months} mo tenure</span>
                  </>
                )}
                {detail.monthly_arpu_usd !== null && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      ${Math.round(detail.monthly_arpu_usd)}/mo ARPU
                    </span>
                  </>
                )}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="return" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-8 mt-4 w-fit">
                <TabsTrigger value="return">Retention</TabsTrigger>
                <TabsTrigger value="customer">Subscriber</TabsTrigger>
                <TabsTrigger value="activity">
                  <Activity className="size-3.5 mr-1" />
                  Activity {actionCount > 0 && `(${actionCount})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="return" className="flex-1 overflow-y-auto px-8 py-6">
                <ReturnTab detail={detail} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="customer" className="flex-1 overflow-y-auto px-8 py-6">
                <CustomerTab detail={detail} />
              </TabsContent>
              <TabsContent value="activity" className="flex-1 overflow-y-auto px-8 py-6">
                <ActivityTab detail={detail} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
