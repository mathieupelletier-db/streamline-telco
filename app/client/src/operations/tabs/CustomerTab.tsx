/**
 * "Subscriber" tab of the drawer. Plan + tenure + geo + the ML retention
 * recommendation summary — gives the care lead context before they decide.
 */
import { OFFER_LABELS } from '@/shared/badges';
import type { SubscriberDetail } from '@/shared/types';

export function CustomerTab({ detail }: { detail: SubscriberDetail }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <DetailRow label="Subscriber id" value={detail.subscriber_id} full />
        <DetailRow label="Plan" value={<span className="capitalize">{detail.plan_type ?? '—'}</span>} />
        <DetailRow
          label="Tenure"
          value={detail.tenure_months !== null ? `${detail.tenure_months} months` : '—'}
        />
        <DetailRow
          label="Monthly ARPU"
          value={detail.monthly_arpu_usd !== null ? `$${detail.monthly_arpu_usd.toFixed(2)}` : '—'}
        />
        <DetailRow label="Home metro" value={detail.home_metro ?? '—'} />
        <DetailRow label="Service node" value={detail.service_node_id ?? '—'} />
        <DetailRow
          label="Churn signal"
          value={detail.churn_signal_score !== null ? detail.churn_signal_score.toFixed(1) : '—'}
        />
      </dl>

      {(detail.recommended_offer || detail.predicted_retained_clv_usd !== null) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Model recommendation
            </div>
            {detail.recommended_offer && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-primary/15 text-primary">
                {OFFER_LABELS[detail.recommended_offer]}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Predicted retained CLV</div>
              <div className="font-mono">
                {detail.predicted_retained_clv_usd !== null
                  ? `$${Math.round(detail.predicted_retained_clv_usd).toLocaleString()}`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Predicted net value</div>
              <div className="font-mono">
                {detail.predicted_net_value_usd !== null
                  ? `$${Math.round(detail.predicted_net_value_usd).toLocaleString()}`
                  : '—'}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Scored by <code>churn_recommender@prod</code>. The Retention tab lets you
            approve or override the pick.
          </div>
        </div>
      )}

      {detail.service_summary && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Service history
          </div>
          <p className="text-sm text-foreground leading-relaxed">{detail.service_summary}</p>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  full,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`flex flex-col sm:grid sm:grid-cols-3 ${full ? 'col-span-2 sm:col-span-1' : ''}`}>
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">{label}</dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}
