/**
 * Analytics — warehouse-backed charts (telco churn / retention).
 *
 * Template intent: surfaces the "lakehouse analytics" half of the story —
 * live SQL-warehouse queries against the Delta lakehouse (not a mock). The
 * header shows the warehouse name + state to make that obvious.
 *
 * How the data flows: each chart fetches `/api/charts/<key>` (see
 * server/routes/charts.ts). That route reads config/queries/<key>.sql —
 * written with IDENTIFIER(:catalog||…) table refs and runs it with the demo's
 * catalog+schema bound as params, so one env var (DEMO_CATALOG/DEMO_SCHEMA)
 * drives the analytics tables on any workspace. Rows come back via
 * `useChartData` and feed the chart components' `data` prop.
 *
 * Repurposing: edit/add a .sql under config/queries/, register its key in
 * charts.ts's QUERY_FILES map, and reference it here via <ChartData chartKey=…>.
 */
import { useEffect, useState } from 'react';
import { BarChart } from '@databricks/appkit-ui/react';
import { useNavigate } from 'react-router';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { OFFER_LABELS } from '@/shared/badges';
import type { OfferType } from '@/shared/types';
import { RtPitch } from '@/architecture/RtPitch';

/**
 * Fetch chart rows from the server's /api/charts/<key> route. That route
 * reads the query SQL, binds the demo catalog/schema, and runs it against the
 * SQL warehouse. We pass the returned rows to the chart components via `data`.
 */
function useChartData<T = Record<string, unknown>>(key: string): {
  data: T[] | null;
  error: string | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    data: T[] | null;
    error: string | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, isLoading: true });
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body.data as T[];
      })
      .then((data) => alive && setState({ data, error: null, isLoading: false }))
      .catch(
        (e) =>
          alive && setState({ data: null, error: String(e?.message ?? e), isLoading: false }),
      );
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

export function AnalyticsView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Churn analytics
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Where the churn risk is concentrated.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — the same numbers the assistant
            reasons about, on a single page. Use the Care Desk to take action; use
            this page to spot patterns.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name ? { name: warehouse.name, state: warehouse.state ?? null } : null
          }
          latencyMs={null}
        />

        {/* Top row: CLV at risk by metro (wide) + at-risk by reason. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <ChartCard title="CLV at risk by metro" scope="Open at-risk" className="lg:col-span-3">
            <ChartData chartKey="clv_at_risk_by_metro" height={260}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="home_metro"
                  yKey="clv_at_risk_usd"
                  colors={[BRAND_PALETTE[0]]}
                  height={260}
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard title="At-risk by churn reason" scope="Open at-risk" className="lg:col-span-2">
            <ChartData chartKey="atrisk_by_reason" height={260}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="churn_reason"
                  yKey="atrisk_count"
                  colors={[BRAND_PALETTE[1]]}
                  height={260}
                />
              )}
            </ChartData>
          </ChartCard>
        </div>

        <ChartCard title="Act here first" scope="Highest CLV at risk" flush>
          {/* Desktop / tablet: dense table. Phone-only card list below. */}
          <div className="hidden sm:block">
            <TopSubscribersTable />
          </div>
          <div className="sm:hidden">
            <TopSubscribersMobile />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Wraps a chart/table in a bordered card with a compact header (title +
 * scope chip). `flush` removes inner padding for components that draw their own.
 */
function ChartCard({
  title,
  scope,
  className,
  flush,
  children,
}: {
  title: string;
  scope?: string;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden ${className ?? ''}`}>
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

/**
 * Fetches /api/charts/<chartKey> and renders the rows via `children` once
 * ready, with loading/error/empty fallbacks.
 */
function ChartData({
  chartKey,
  height,
  children,
}: {
  chartKey: string;
  height: number;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  const { data, error, isLoading } = useChartData(chartKey);
  const center = `flex items-center justify-center text-sm`;
  if (error) {
    return (
      <div className={`${center} text-destructive`} style={{ height }}>
        Error loading chart: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        No data.
      </div>
    );
  }
  return <>{children(data)}</>;
}

/**
 * top_atrisk_subscribers — the highest-CLV at-risk subscribers + the model's
 * recommended offer. Phone card list + desktop dense table share the query.
 */
type TopSubscriberRow = {
  subscriber_id: string;
  home_metro: string | null;
  plan_type: string | null;
  churn_reason: string | null;
  churn_risk_score: number;
  clv_at_risk_usd: number;
  recommended_offer: OfferType | null;
  predicted_net_value_usd: number | null;
};

const compactUsd = (n: number | null) =>
  n === null ? '—' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function riskToneClass(score: number): string {
  if (score >= 0.7) return 'text-[var(--severity-danger)]';
  if (score >= 0.4) return 'text-[var(--severity-warning)]';
  return 'text-foreground';
}

function offerLabel(offer: OfferType | null): string {
  return offer ? OFFER_LABELS[offer] : '—';
}

/** Shared fetch + state-handling. */
function useTopSubscribers():
  | { data: TopSubscriberRow[] }
  | { fallback: React.ReactNode } {
  const { data, error, isLoading } = useChartData<TopSubscriberRow>('top_atrisk_subscribers');
  if (error) {
    return {
      fallback: <div className="px-4 py-3 text-sm text-destructive">Couldn't load subscribers: {error}</div>,
    };
  }
  if (isLoading || !data) {
    return {
      fallback: <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</div>,
    };
  }
  if (data.length === 0) {
    return {
      fallback: <div className="px-4 py-6 text-sm text-muted-foreground text-center">No at-risk subscribers.</div>,
    };
  }
  return { data };
}

function TopSubscribersMobile() {
  const navigate = useNavigate();
  const r = useTopSubscribers();
  if ('fallback' in r) return r.fallback;
  return (
    <ul className="divide-y divide-border">
      {r.data.map((row) => (
        <li
          key={row.subscriber_id}
          className="px-4 py-3 cursor-pointer hover:bg-muted/40"
          onClick={() => navigate(`/operations?metro=${encodeURIComponent(row.home_metro ?? '')}`)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-medium truncate">{row.subscriber_id}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[row.home_metro, row.plan_type].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`display text-xl font-semibold ${riskToneClass(row.churn_risk_score)}`}>
                {(row.churn_risk_score * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">churn risk</div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{offerLabel(row.recommended_offer)}</span>
            <span className="font-mono text-foreground">{compactUsd(row.clv_at_risk_usd)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TopSubscribersTable() {
  const navigate = useNavigate();
  const r = useTopSubscribers();
  if ('fallback' in r) return r.fallback;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Subscriber</th>
            <th className="text-left font-medium px-3 py-2">Metro</th>
            <th className="text-left font-medium px-3 py-2">Plan</th>
            <th className="text-left font-medium px-3 py-2">Reason</th>
            <th className="text-right font-medium px-3 py-2">Risk</th>
            <th className="text-right font-medium px-3 py-2">CLV at risk</th>
            <th className="text-left font-medium px-3 py-2">Recommended</th>
            <th className="text-right font-medium px-3 py-2">Net value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {r.data.map((row) => (
            <tr
              key={row.subscriber_id}
              className="hover:bg-muted/40 cursor-pointer"
              onClick={() => navigate(`/operations?metro=${encodeURIComponent(row.home_metro ?? '')}`)}
            >
              <td className="px-3 py-2 font-mono text-xs">{row.subscriber_id}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.home_metro ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground capitalize">{row.plan_type ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground capitalize">{row.churn_reason ?? '—'}</td>
              <td className={`px-3 py-2 text-right font-semibold ${riskToneClass(row.churn_risk_score)}`}>
                {(row.churn_risk_score * 100).toFixed(0)}%
              </td>
              <td className="px-3 py-2 text-right font-mono">{compactUsd(row.clv_at_risk_usd)}</td>
              <td className="px-3 py-2">{offerLabel(row.recommended_offer)}</td>
              <td className="px-3 py-2 text-right font-mono">{compactUsd(row.predicted_net_value_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
