/**
 * "Retention" tab of the subscriber drawer. Shows the churn drivers, the ML
 * model's ranked retention offers, and an approve/decline form that records a
 * care action (the same write the agent makes via execute_retention_action).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { decideSubscriber } from '@/lib/caredesk';
import { OFFER_LABELS } from '@/shared/badges';
import type { OfferType, SubscriberDetail } from '@/shared/types';

export function ReturnTab({
  detail,
  onMutated,
}: {
  detail: SubscriberDetail;
  onMutated: () => void;
}) {
  const ranked = useMemo(
    () => [...(detail.offer_ranking ?? [])].sort((a, b) => b.predictedNetValueUsd - a.predictedNetValueUsd),
    [detail.offer_ranking],
  );
  const defaultOffer: OfferType =
    detail.recommended_offer ?? ranked[0]?.offerType ?? 'bill_credit';

  const [selectedOffer, setSelectedOffer] = useState<OfferType>(defaultOffer);
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<'approved' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset selection + notes when the drawer switches subscribers.
  useEffect(() => {
    setSelectedOffer(defaultOffer);
    setNotes('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.subscriber_id]);

  const latestAction = detail.actions[0] ?? null;
  const isDecided = latestAction !== null;

  async function decide(decision: 'approved' | 'declined') {
    setPending(decision);
    setError(null);
    try {
      const predicted =
        ranked.find((o) => o.offerType === selectedOffer)?.predictedRetainedClvUsd ??
        detail.predicted_retained_clv_usd ??
        null;
      await decideSubscriber(detail.subscriber_id, {
        decision,
        offerType: selectedOffer,
        predictedRetainedClvUsd: predicted,
        notes: notes || undefined,
      });
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Churn drivers */}
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <DetailRow
          label="Churn risk"
          value={
            detail.churn_risk_score !== null
              ? `${(detail.churn_risk_score * 100).toFixed(0)}%`
              : '—'
          }
        />
        <DetailRow
          label="CLV at risk"
          value={
            detail.clv_at_risk_usd !== null
              ? `$${Math.round(detail.clv_at_risk_usd).toLocaleString()}`
              : '—'
          }
        />
        <DetailRow label="Open tickets" value={detail.open_ticket_count ?? 0} />
        <DetailRow
          label="Signals"
          value={
            [
              detail.has_open_outage ? 'Outage' : null,
              detail.has_open_billing ? 'Billing' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'None'
          }
        />
        <DetailRow label="Service history" value={detail.service_summary ?? '—'} full />
      </dl>

      {/* Ranked offers from the ML model */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Ranked retention offers {detail.recommended_offer && '· model pick highlighted'}
        </div>
        {ranked.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No model recommendation yet for this subscriber. Pick an offer manually below.
          </div>
        ) : (
          <ul className="space-y-2">
            {ranked.map((o) => {
              const isPick = o.offerType === detail.recommended_offer;
              const isSelected = o.offerType === selectedOffer;
              return (
                <li key={o.offerType}>
                  <button
                    type="button"
                    onClick={() => setSelectedOffer(o.offerType)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-foreground/40 bg-muted/50'
                        : 'border-border bg-card hover:border-foreground/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`size-3.5 rounded-full border shrink-0 ${
                          isSelected ? 'border-foreground bg-foreground' : 'border-muted-foreground/40'
                        }`}
                        aria-hidden
                      />
                      <span className="font-medium truncate">{OFFER_LABELS[o.offerType]}</span>
                      {isPick && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-primary/15 text-primary shrink-0">
                          model pick
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm">
                        ${Math.round(o.predictedNetValueUsd).toLocaleString()} net
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        ${Math.round(o.predictedRetainedClvUsd).toLocaleString()} retained · ${Math.round(o.costUsd)} cost
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isDecided && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Latest action on this subscriber: <strong>{latestAction.status}</strong>
          {latestAction.offer_type && <> · {OFFER_LABELS[latestAction.offer_type]}</>}
          {latestAction.approved_by && <> · by {latestAction.approved_by}</>}. You can record another.
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add context for the care team…"
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="flex gap-2">
          <ActionButton
            label={`Approve ${OFFER_LABELS[selectedOffer]}`}
            icon={<CheckCircle2 className="size-4" />}
            onClick={() => decide('approved')}
            pending={pending === 'approved'}
            variant="success"
          />
          <ActionButton
            label="Decline"
            icon={<XCircle className="size-4" />}
            onClick={() => decide('declined')}
            pending={pending === 'declined'}
            variant="neutral"
          />
        </div>
      </div>
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

function ActionButton({
  label,
  icon,
  onClick,
  pending,
  disabled = false,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
  variant: 'success' | 'neutral' | 'danger';
}) {
  const cls =
    variant === 'success'
      ? 'bg-success text-success-foreground hover:opacity-90'
      : variant === 'danger'
        ? 'bg-warning text-warning-foreground hover:opacity-90'
        : 'bg-muted text-foreground hover:bg-muted/70';
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
    >
      {icon}
      {pending ? '…' : label}
    </button>
  );
}
