/**
 * The Care Desk page — the WRITE SURFACE for the use case.
 *
 * Renders the at-risk subscriber queue from Lakebase (live, writable,
 * transactional) and stays in sync with the agent's actions via the
 * `dataMutated` pub/sub — when the chat stream completes, the queue refetches,
 * so you literally WATCH the agent's retention writes land here.
 *
 * Responsibility: orchestration only — owns filter/selection state, fetches
 * data, subscribes to `dataMutated`. Sub-components render the pieces:
 *
 *    KpiCards       — at-risk / critical / actions / CLV saved at a glance
 *    CityMap        — at-risk subscribers by metro (bubble map)
 *    ReturnsTable   — filterable subscriber queue, click a row → drawer
 *    ReturnDrawer   — slide-over with Retention / Subscriber / Activity tabs
 *
 * The "Ask the assistant" banner opens the floating dock with a scripted
 * prompt prefilled — showing how the assistant and the queue are two sides of
 * the same governed data.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchCareQueue, fetchCareSummary } from '@/lib/caredesk';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type { CareQueueRow, CareSummary, RiskBand } from '@/shared/types';

import { CityMap } from './CityMap';
import { KpiCards } from './KpiCards';
import { ReturnsTable } from './ReturnsTable';
import { ReturnDrawer } from './ReturnDrawer';
import { IngestionFlow } from '@/architecture/IngestionFlow';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [band, setBand] = useState<RiskBand | 'all'>('all');
  const [metroFilter, setMetroFilter] = useState(searchParams.get('metro') ?? '');
  const [reasonFilter, setReasonFilter] = useState<string | null>(searchParams.get('reason'));
  const [sort, setSort] = useState<'risk' | 'clv' | 'recent'>(
    (searchParams.get('sort') as 'risk' | 'clv' | 'recent') ?? 'risk',
  );
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  // Sync queue filters → URL so deep links + back/forward work.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('metro', metroFilter || null);
    setOrDelete('reason', reasonFilter);
    setOrDelete('sort', sort === 'risk' ? null : sort);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metroFilter, reasonFilter, sort]);

  // Update state when URL changes (e.g. user clicks a link from Analytics).
  useEffect(() => {
    const urlMetro = searchParams.get('metro') ?? '';
    if (urlMetro !== metroFilter) setMetroFilter(urlMetro);
    const urlReason = searchParams.get('reason');
    if (urlReason !== reasonFilter) setReasonFilter(urlReason);
    const urlSort = (searchParams.get('sort') as 'clv' | 'recent' | null) ?? 'risk';
    if (urlSort !== sort) setSort(urlSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [rows, setRows] = useState<CareQueueRow[]>([]);
  const [summary, setSummary] = useState<CareSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchCareQueue({
          riskBand: band === 'all' ? undefined : band,
          churnReason: reasonFilter ?? undefined,
          metro: metroFilter || undefined,
          sort,
        }),
        fetchCareSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, metroFilter, reasonFilter, sort]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, metroFilter, reasonFilter, sort]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.subscriberId.toLowerCase().includes(q) ||
        (r.homeMetro ?? '').toLowerCase().includes(q) ||
        (r.planType ?? '').toLowerCase().includes(q) ||
        (r.churnReason ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 lg:items-end">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Care Desk — retention queue
              </div>
              <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
                Save the at-risk subscribers.
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Each row is a subscriber the churn model flagged. Review the driver,
              approve the ranked retention offer, or decline — the write lands in
              Lakebase and the queue updates live.
            </p>
            {config?.assistantScript?.[0] && (
              <button
                onClick={() => dockController.openAndSend(config.assistantScript[0].prompt)}
                className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Sparkles className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Churn risk spiking
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">
                    Ask the assistant who to save first
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            )}
          </div>
          <IngestionFlow />
        </div>

        <KpiCards summary={summary} />

        <CityMap />

        <ReturnsTable
          rows={filteredRows}
          loading={loading}
          error={error}
          bandFilter={band}
          onBandFilter={setBand}
          search={search}
          onSearch={setSearch}
          metroFilter={metroFilter}
          onMetroFilter={setMetroFilter}
          reasonFilter={reasonFilter}
          onReasonFilter={setReasonFilter}
          sort={sort}
          onSortChange={setSort}
          onSelect={setSelectedId}
        />
      </div>

      <ReturnDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => {
          setSelectedId(null);
          void reload();
        }}
      />
    </div>
  );
}
