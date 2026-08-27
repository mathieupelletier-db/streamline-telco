/**
 * Timeline of care actions taken on this subscriber. Each care action expands
 * to show its lifecycle events (proposed → approved → executed / declined) from
 * app.care_action_events, plus the drafted retention summary.
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  StickyNote,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { OFFER_LABELS } from '@/shared/badges';
import type { CareActionTimelineEntry, SubscriberAction, SubscriberDetail } from '@/shared/types';

export function ActivityTab({ detail }: { detail: SubscriberDetail }) {
  const actions = useMemo(
    () =>
      [...detail.actions].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      ),
    [detail.actions],
  );

  if (actions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground max-w-md">
        No retention actions on this subscriber yet. Once the assistant (or a care
        lead) approves an offer, it will show up here with its full lifecycle.
      </div>
    );
  }

  return (
    <ol className="space-y-3 max-w-3xl">
      {actions.map((a) => (
        <li key={a.action_id}>
          <ActionRow action={a} />
        </li>
      ))}
    </ol>
  );
}

function ActionRow({ action }: { action: SubscriberAction }) {
  const [expanded, setExpanded] = useState(false);
  const { icon, tone, label } = describe(action.status);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors"
      >
        <div className={`size-7 rounded-full flex items-center justify-center shrink-0 ${tone}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium truncate">
            {label} · {OFFER_LABELS[action.offer_type]}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {action.approved_by ?? 'system'}
            {action.predicted_retained_clv_usd !== null &&
              ` · $${Math.round(action.predicted_retained_clv_usd).toLocaleString()} retained CLV`}
          </div>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">{fmt(action.decided_at ?? action.created_at)}</div>
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-border bg-background space-y-3">
          {action.drafted_summary && (
            <div className="text-sm leading-relaxed flex items-start gap-2">
              <Sparkles className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <span className="whitespace-pre-wrap">{action.drafted_summary}</span>
            </div>
          )}
          {action.timeline.length > 0 && (
            <ol className="space-y-1.5">
              {action.timeline.map((e) => (
                <TimelineEntry key={e.event_id} entry={e} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ entry }: { entry: CareActionTimelineEntry }) {
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50 shrink-0" aria-hidden />
      <span className="font-medium text-foreground capitalize">{entry.event_type}</span>
      {entry.notes && <span>· {entry.notes}</span>}
      <span className="ml-auto shrink-0">{fmt(entry.at)}</span>
    </li>
  );
}

function describe(status: SubscriberAction['status']) {
  switch (status) {
    case 'approved':
    case 'executed':
      return {
        icon: <CheckCircle2 className="size-3.5" />,
        tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
        label: status === 'executed' ? 'Executed' : 'Approved',
      };
    case 'declined':
      return {
        icon: <XCircle className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: 'Declined',
      };
    default:
      return {
        icon: <StickyNote className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: 'Proposed',
      };
  }
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
