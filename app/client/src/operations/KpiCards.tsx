/**
 * KPI cards at the top of the Care Desk queue: at-risk subscribers, critical
 * band, actions taken, and CLV saved. Drives the "live update" demo moment —
 * when the agent (or a care lead) records a retention action and fires
 * `dataMutated`, the cards that *moved* pulse a primary ring (usePulseOnChange).
 */
import { AlertTriangle, CheckCircle2, ShieldAlert, TrendingUp } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { CareSummary } from '@/shared/types';

export function KpiCards({ summary }: { summary: CareSummary | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
      <Card
        label="At risk"
        count={summary?.total_at_risk ?? 0}
        dollars={summary?.total_clv_at_risk_usd ?? 0}
        icon={<ShieldAlert className="size-4" />}
        tone="neutral"
      />
      <Card
        label="Critical"
        count={summary?.total_critical ?? 0}
        icon={<AlertTriangle className="size-4" />}
        tone="danger"
      />
      <Card
        label="Actions taken"
        count={summary?.total_actioned ?? 0}
        icon={<CheckCircle2 className="size-4" />}
        tone="success"
      />
      <Card
        label="CLV saved"
        count={summary?.total_actioned ?? 0}
        dollars={summary?.total_clv_saved_usd ?? 0}
        dollarsOnly
        icon={<TrendingUp className="size-4" />}
        tone="success"
      />
    </div>
  );
}

function Card({
  label,
  count,
  dollars,
  dollarsOnly,
  icon,
  tone,
}: {
  label: string;
  count: number;
  dollars?: number;
  /** Show only the $ figure as the headline (used for "CLV saved"). */
  dollarsOnly?: boolean;
  icon: React.ReactNode;
  tone: 'neutral' | 'success' | 'danger';
}) {
  // Pulse on the value that changes: $ for the CLV-saved card, count elsewhere.
  const pulse = usePulseOnChange(dollarsOnly ? (dollars ?? 0) : count);
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success-subtle-foreground)]'
      : tone === 'danger'
        ? 'text-destructive'
        : 'text-foreground';
  const compactDollar = (v: number) =>
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v);
  const fullDollar = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
        {dollarsOnly ? (
          <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
            <span className="sm:hidden">${compactDollar(dollars ?? 0)}</span>
            <span className="hidden sm:inline">${fullDollar(dollars ?? 0)}</span>
          </div>
        ) : (
          <>
            <div className="display text-2xl sm:text-3xl font-semibold text-foreground">
              {count.toLocaleString()}
            </div>
            {dollars !== undefined && (
              <div className="text-xs sm:text-sm text-muted-foreground">
                <span className="sm:hidden">${compactDollar(dollars)}</span>
                <span className="hidden sm:inline">· ${fullDollar(dollars)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
