/**
 * Small pill-style badges reused across the Care Desk pages + home activity
 * feed. If you add a new status / band / reason, update both the type union
 * in shared/types.ts and the colour map here.
 */
import type { CareActionStatus, RiskBand, ChurnReason, OfferType } from './types';

/** Care action lifecycle status (proposed / approved / executed / declined). */
export function StatusBadge({ status }: { status: CareActionStatus }) {
  const styles: Record<CareActionStatus, string> = {
    proposed: 'bg-muted text-foreground',
    approved: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    executed: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    declined: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

/** Churn risk band (critical / elevated / watch / healthy). */
export function RiskBadge({ band }: { band: RiskBand }) {
  const styles: Record<RiskBand, string> = {
    critical: 'bg-destructive/10 text-destructive',
    elevated: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
    watch: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    healthy: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[band]}`}
    >
      {band}
    </span>
  );
}

const REASON_LABELS: Record<ChurnReason, string> = {
  service: 'Service',
  price: 'Price',
  device: 'Device',
};

/** Why a subscriber is at risk (service / price / device). */
export function ReasonBadge({ reason }: { reason: ChurnReason }) {
  const styles: Record<ChurnReason, string> = {
    service: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    price: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
    device: 'bg-muted text-foreground',
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${styles[reason]}`}
    >
      {REASON_LABELS[reason]}
    </span>
  );
}

export const OFFER_LABELS: Record<OfferType, string> = {
  bill_credit: 'Bill credit',
  plan_upgrade_discount: 'Plan discount',
  device_upgrade: 'Device upgrade',
};

/** The retention offer type. */
export function OfferBadge({ offer }: { offer: OfferType }) {
  const styles: Record<OfferType, string> = {
    bill_credit: 'bg-primary/15 text-primary',
    plan_upgrade_discount: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
    device_upgrade: 'bg-muted text-foreground',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${styles[offer]}`}
    >
      {OFFER_LABELS[offer]}
    </span>
  );
}
