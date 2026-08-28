/**
 * The at-risk subscriber queue table. Risk-band filter chips + search + a
 * churn-reason chip + the row list itself. Click a row → opens the subscriber
 * drawer. Rows whose care-action status changed between dataMutated refetches
 * pulse a soft primary highlight (1.5s) so the user's eye lands on what the
 * agent (or a care lead) just actioned.
 */
import { Search } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { CareQueueRow, RiskBand } from '@/shared/types';
import { RiskBadge, ReasonBadge, OfferBadge, StatusBadge } from '@/shared/badges';

const BAND_TABS: { value: RiskBand | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'elevated', label: 'Elevated' },
  { value: 'watch', label: 'Watch' },
];

function SortHeader({
  label,
  active,
  onClick,
  align = 'left',
  hint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`inline-flex items-center gap-1 ${
        align === 'right' ? 'flex-row-reverse' : ''
      } ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      } transition-colors cursor-pointer`}
    >
      {label}
      <span className="text-[10px]" aria-hidden>
        {active ? '↓' : '↕'}
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr
          key={i}
          className="border-t border-border"
          style={{ animation: `skelPulse 1.2s ease-in-out ${i * 60}ms infinite` }}
        >
          <td className="px-4 py-3">
            <div className="h-3 w-40 rounded bg-muted" />
            <div className="mt-1.5 h-2 w-24 rounded bg-muted/70" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-28 rounded bg-muted" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-20 rounded bg-muted" />
          </td>
          <td className="px-4 py-3">
            <div className="h-1.5 w-12 rounded-full bg-muted" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="h-3 w-14 rounded bg-muted ml-auto" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 rounded-md bg-muted" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-16 rounded-full bg-muted" />
          </td>
        </tr>
      ))}
      <style>{`
        @keyframes skelPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

type SortKey = 'risk' | 'clv' | 'recent';

type Props = {
  rows: CareQueueRow[];
  loading: boolean;
  error: string | null;
  bandFilter: RiskBand | 'all';
  onBandFilter: (b: RiskBand | 'all') => void;
  search: string;
  onSearch: (s: string) => void;
  metroFilter: string;
  onMetroFilter: (metro: string) => void;
  reasonFilter: string | null;
  onReasonFilter: (r: string | null) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onSelect: (id: string) => void;
};

export function ReturnsTable({
  rows,
  loading,
  error,
  bandFilter,
  onBandFilter,
  search,
  onSearch,
  metroFilter,
  onMetroFilter,
  reasonFilter,
  onReasonFilter,
  sort,
  onSortChange,
  onSelect,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Risk band filter"
          className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
        >
          {BAND_TABS.map((s) => {
            const active = bandFilter === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onBandFilter(s.value)}
                aria-pressed={active}
                className={`relative z-10 rounded-full px-3 py-1 transition-colors duration-200 ${
                  active ? 'text-background' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-full bg-foreground transition-all"
                    style={{ viewTransitionName: 'status-tab-active' }}
                    aria-hidden
                  />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-[180px]">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search subscriber, metro, plan…"
            className="bg-transparent outline-none w-full sm:w-60 placeholder:text-muted-foreground"
          />
        </div>
        {metroFilter && (
          <button
            onClick={() => onMetroFilter('')}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Metro: {metroFilter} ✕
          </button>
        )}
        {reasonFilter && (
          <button
            onClick={() => onReasonFilter(null)}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground capitalize"
          >
            Reason: {reasonFilter} ✕
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden" aria-hidden>
            <div
              className="h-full w-1/3 rounded-full"
              style={{ background: 'var(--primary)', animation: 'loadingBar 1.1s ease-in-out infinite' }}
            />
          </div>
        )}

        {/* ───── PHONE: card list ───── */}
        <ul
          className={`sm:hidden divide-y divide-border transition-opacity duration-150 ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {loading && rows.length === 0 && (
            <li className="px-4 py-6 text-center text-muted-foreground text-sm">Loading…</li>
          )}
          {!loading && rows.length === 0 && (
            <li className="px-4 py-8 text-center text-muted-foreground text-sm">
              No subscribers match the current filters.
            </li>
          )}
          {rows.map((r) => (
            <MobileCard
              key={r.subscriberId}
              row={r}
              onSelect={onSelect}
              onMetroFilter={onMetroFilter}
              onReasonFilter={onReasonFilter}
            />
          ))}
        </ul>

        {/* ───── TABLET + DESKTOP: full table ───── */}
        <div
          className={`hidden sm:block transition-opacity duration-150 overflow-x-auto ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Subscriber</th>
                <th className="text-left px-4 py-2 font-semibold">Reason</th>
                <th className="text-left px-4 py-2 font-semibold">Band</th>
                <th className="text-left px-4 py-2 font-semibold">
                  <SortHeader
                    label="Risk"
                    active={sort === 'risk'}
                    onClick={() => onSortChange('risk')}
                    hint="Sort by churn risk score"
                  />
                </th>
                <th className="text-right px-4 py-2 font-semibold">
                  <SortHeader
                    label="CLV at risk"
                    align="right"
                    active={sort === 'clv'}
                    onClick={() => onSortChange('clv')}
                    hint="Sort by customer lifetime value at risk"
                  />
                </th>
                <th className="text-left px-4 py-2 font-semibold">Recommended</th>
                <th className="text-left px-4 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <SkeletonRows />}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No subscribers match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Row
                  key={r.subscriberId}
                  row={r}
                  onSelect={onSelect}
                  onMetroFilter={onMetroFilter}
                  onReasonFilter={onReasonFilter}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AngerlessRiskBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.max(0, score * 100));
  return (
    <div className="flex items-center gap-1.5" title={`Churn risk score: ${(score * 100).toFixed(0)}%`}>
      <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
        <div
          className={
            score >= 0.7 ? 'h-full bg-destructive' : score >= 0.4 ? 'h-full bg-amber-500' : 'h-full bg-muted-foreground/50'
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-7 text-right">
        {(score * 100).toFixed(0)}
      </span>
    </div>
  );
}

function Row({
  row: r,
  onSelect,
  onMetroFilter,
  onReasonFilter,
}: {
  row: CareQueueRow;
  onSelect: (id: string) => void;
  onMetroFilter: (metro: string) => void;
  onReasonFilter: (r: string | null) => void;
}) {
  // Pulse the row when a care action lands on this subscriber (null → approved
  // is the load-bearing one). Ignores the first render so rows don't flash on
  // page load, only on a real change between refetches.
  const actionPulse = usePulseOnChange(r.actionStatus ?? 'none');
  return (
    <tr
      onClick={() => onSelect(r.subscriberId)}
      className={`cursor-pointer border-t border-border hover:bg-muted/50 transition-colors ${
        actionPulse ? 'animate-pulse-row' : ''
      }`}
    >
      <td className="px-4 py-2">
        <div className="font-mono font-medium">{r.subscriberId}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {r.planType && <span className="capitalize">{r.planType}</span>}
          {r.homeMetro && (
            <>
              <span>·</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMetroFilter(r.homeMetro ?? '');
                }}
                className="hover:text-foreground"
              >
                {r.homeMetro}
              </button>
            </>
          )}
        </div>
      </td>
      <td className="px-4 py-2">
        {r.churnReason ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReasonFilter(r.churnReason);
            }}
          >
            <ReasonBadge reason={r.churnReason} />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        <RiskBadge band={r.riskBand} />
      </td>
      <td className="px-4 py-2">
        <AngerlessRiskBar score={r.churnRiskScore} />
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {r.clvAtRiskUsd !== null ? `$${Math.round(r.clvAtRiskUsd).toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-2">
        {r.recommendedOffer ? <OfferBadge offer={r.recommendedOffer} /> : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-2">
        {r.actionStatus ? (
          <StatusBadge status={r.actionStatus} />
        ) : (
          <span className="text-xs text-muted-foreground">Pending</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Phone-only card for one subscriber. Stacks the same fields the desktop Row
 * shows, with the action status prominent top-right so the retention action
 * landing is impossible to miss.
 */
function MobileCard({
  row: r,
  onSelect,
  onMetroFilter,
  onReasonFilter,
}: {
  row: CareQueueRow;
  onSelect: (id: string) => void;
  onMetroFilter: (metro: string) => void;
  onReasonFilter: (r: string | null) => void;
}) {
  const actionPulse = usePulseOnChange(r.actionStatus ?? 'none');
  return (
    <li
      onClick={() => onSelect(r.subscriberId)}
      className={`px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
        actionPulse ? 'animate-pulse-row' : ''
      }`}
    >
      {/* Row 1 — subscriber id (left) + band & action badges (right) */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono font-medium text-sm truncate">{r.subscriberId}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
            {r.planType && <span className="capitalize">{r.planType}</span>}
            {r.homeMetro && (
              <>
                <span>·</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMetroFilter(r.homeMetro ?? '');
                  }}
                >
                  {r.homeMetro}
                </button>
              </>
            )}
            {r.churnReason && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReasonFilter(r.churnReason);
                }}
              >
                <ReasonBadge reason={r.churnReason} />
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RiskBadge band={r.riskBand} />
          {r.actionStatus && <StatusBadge status={r.actionStatus} />}
        </div>
      </div>

      {/* Row 2 — recommended offer + CLV at risk (right-aligned $) */}
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div>
          {r.recommendedOffer ? <OfferBadge offer={r.recommendedOffer} /> : <span>No recommendation yet</span>}
        </div>
        <div className="font-mono text-foreground shrink-0">
          {r.clvAtRiskUsd !== null ? `$${Math.round(r.clvAtRiskUsd).toLocaleString()}` : '—'}
        </div>
      </div>

      {/* Row 3 — risk bar */}
      {r.churnRiskScore !== null && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="uppercase tracking-[0.12em] font-semibold">Risk</span>
          <div className="h-1.5 flex-1 max-w-[120px] rounded-full bg-muted overflow-hidden">
            <div
              className={
                r.churnRiskScore >= 0.7
                  ? 'h-full bg-destructive'
                  : r.churnRiskScore >= 0.4
                    ? 'h-full bg-amber-500'
                    : 'h-full bg-muted-foreground/50'
              }
              style={{ width: `${Math.min(100, Math.max(0, r.churnRiskScore * 100))}%` }}
            />
          </div>
          <span className="font-mono tabular-nums w-6 text-right">
            {(r.churnRiskScore * 100).toFixed(0)}
          </span>
        </div>
      )}
    </li>
  );
}
