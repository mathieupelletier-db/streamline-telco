/**
 * Streamline Telco Care Desk — view-facing read queries + the queue's write.
 *
 * These back the Operations (care-desk queue), Home (activity feed), and the
 * subscriber detail drawer. They read the synced read-only mirrors
 * (`app.subscriber_position`, `app.retention_recommendations`) and the writable
 * `app.care_actions` / `app.care_action_events` tables.
 *
 * The queue is "at-risk subscribers waiting for a retention decision": every
 * non-healthy `subscriber_position` row, LEFT JOINed to (a) its ML retention
 * recommendation and (b) its latest care action — so "offer applied" status
 * comes from the writable table while the read-only position is never mutated.
 *
 * The agent's tool-facing queries (find_atrisk_subscriber, rank_offers,
 * search_history, execute_retention_action) live in `subscribers.ts`. This file
 * is the human-facing UI side of the same data.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { careActions, careActionEvents, careAgents } from '../schema.js';

// ── Types (mirror client/src/shared/types.ts) ────────────────────────────────

export type CareQueueRow = {
  subscriberId: string;
  planType: string | null;
  tenureMonths: number | null;
  monthlyArpuUsd: number | null;
  homeMetro: string | null;
  subLat: number | null;
  subLng: number | null;
  churnRiskScore: number | null;
  churnReason: string | null;
  riskBand: string;
  openTicketCount: number | null;
  hasOpenOutage: boolean | null;
  hasOpenBilling: boolean | null;
  clvAtRiskUsd: number | null;
  recommendedOffer: string | null;
  predictedRetainedClvUsd: number | null;
  predictedNetValueUsd: number | null;
  actionStatus: string | null;
  actionOfferType: string | null;
  actionAt: string | null;
};

export type CareSummary = {
  total_at_risk: number;
  total_critical: number;
  total_elevated: number;
  total_watch: number;
  total_actioned: number;
  total_clv_at_risk_usd: number;
  total_clv_saved_usd: number;
};

export type MetroBucket = {
  metro: string;
  lat: number;
  lng: number;
  count: number;
  actioned: number;
  clv_at_risk_usd: number;
};

export type CareActivity = {
  action_id: string;
  subscriber_id: string;
  offer_type: string;
  status: string;
  approved_by: string | null;
  predicted_retained_clv_usd: number | null;
  drafted_summary: string | null;
  home_metro: string | null;
  plan_type: string | null;
  at: string;
};

export type CareActionTimelineEntry = {
  event_id: string;
  event_type: string;
  actor_email: string | null;
  notes: string | null;
  at: string;
};

export type SubscriberDetail = {
  subscriber_id: string;
  plan_type: string | null;
  tenure_months: number | null;
  monthly_arpu_usd: number | null;
  service_node_id: string | null;
  home_metro: string | null;
  sub_lat: number | null;
  sub_lng: number | null;
  service_summary: string | null;
  churn_risk_score: number | null;
  churn_reason: string | null;
  open_ticket_count: number | null;
  has_open_outage: boolean | null;
  has_open_billing: boolean | null;
  churn_signal_score: number | null;
  clv_at_risk_usd: number | null;
  risk_band: string;
  recommended_offer: string | null;
  predicted_retained_clv_usd: number | null;
  predicted_net_value_usd: number | null;
  offer_ranking: unknown;
  actions: Array<{
    action_id: string;
    offer_type: string;
    offer_id: string | null;
    status: string;
    approved_by: string | null;
    predicted_retained_clv_usd: number | null;
    drafted_summary: string | null;
    created_at: string;
    decided_at: string | null;
    timeline: CareActionTimelineEntry[];
  }>;
};

// db.execute returns { rows } on node-postgres; normalize to a plain array.
function toRows<T>(result: unknown): T[] {
  const r = result as { rows?: unknown[] };
  return (r.rows ?? (result as unknown[])) as T[];
}

// ── Queue ─────────────────────────────────────────────────────────────────

/**
 * The care-desk queue: at-risk subscribers with their ML recommendation and
 * latest care action. Filters/sorts applied server-side so the client stays
 * thin. `actioned` filters to rows that do (true) / don't (false) yet have a
 * care action.
 */
export async function listCareQueue(
  db: AppDb,
  filters: {
    riskBand?: string;
    churnReason?: string;
    metro?: string;
    actioned?: boolean;
    sort?: 'risk' | 'clv' | 'recent';
    limit?: number;
  } = {},
): Promise<CareQueueRow[]> {
  const conditions = [sql`p.risk_band <> 'healthy'`];
  if (filters.riskBand) conditions.push(sql`p.risk_band = ${filters.riskBand}`);
  if (filters.churnReason) conditions.push(sql`p.churn_reason = ${filters.churnReason}`);
  if (filters.metro) conditions.push(sql`p.home_metro = ${filters.metro}`);
  if (filters.actioned === true) conditions.push(sql`la.status IS NOT NULL`);
  if (filters.actioned === false) conditions.push(sql`la.status IS NULL`);
  const where = sql.join(conditions, sql` AND `);

  const orderBy =
    filters.sort === 'clv'
      ? sql`p.clv_at_risk_usd DESC NULLS LAST`
      : filters.sort === 'recent'
        ? sql`la.decided_at DESC NULLS LAST, p.churn_risk_score DESC NULLS LAST`
        : sql`p.churn_risk_score DESC NULLS LAST`;
  const limit = filters.limit ?? 500;

  const result = await db.execute(sql`
    SELECT
      p.subscriber_id            AS "subscriberId",
      p.plan_type                AS "planType",
      p.tenure_months            AS "tenureMonths",
      p.monthly_arpu_usd         AS "monthlyArpuUsd",
      p.home_metro               AS "homeMetro",
      p.sub_lat                  AS "subLat",
      p.sub_lng                  AS "subLng",
      p.churn_risk_score         AS "churnRiskScore",
      p.churn_reason             AS "churnReason",
      p.risk_band                AS "riskBand",
      p.open_ticket_count        AS "openTicketCount",
      p.has_open_outage          AS "hasOpenOutage",
      p.has_open_billing         AS "hasOpenBilling",
      p.clv_at_risk_usd          AS "clvAtRiskUsd",
      r.recommended_offer        AS "recommendedOffer",
      r.predicted_retained_clv_usd AS "predictedRetainedClvUsd",
      r.predicted_net_value_usd  AS "predictedNetValueUsd",
      la.status                  AS "actionStatus",
      la.offer_type              AS "actionOfferType",
      la.decided_at              AS "actionAt"
    FROM app.subscriber_position p
    LEFT JOIN app.retention_recommendations r
      ON r.subscriber_id = p.subscriber_id
    LEFT JOIN LATERAL (
      SELECT ca.status, ca.offer_type, ca.decided_at
      FROM app.care_actions ca
      WHERE ca.subscriber_id = p.subscriber_id
      ORDER BY ca.created_at DESC
      LIMIT 1
    ) la ON TRUE
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);
  return toRows<CareQueueRow>(result);
}

/** KPI counts for the top of the care-desk queue. */
export async function careSummary(db: AppDb): Promise<CareSummary> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE p.risk_band <> 'healthy')                        AS total_at_risk,
      COUNT(*) FILTER (WHERE p.risk_band = 'critical')                        AS total_critical,
      COUNT(*) FILTER (WHERE p.risk_band = 'elevated')                        AS total_elevated,
      COUNT(*) FILTER (WHERE p.risk_band = 'watch')                           AS total_watch,
      COUNT(la.subscriber_id)                                                 AS total_actioned,
      COALESCE(SUM(p.clv_at_risk_usd) FILTER (WHERE p.risk_band <> 'healthy'), 0) AS total_clv_at_risk_usd,
      COALESCE(SUM(la.predicted_retained_clv_usd), 0)                         AS total_clv_saved_usd
    FROM app.subscriber_position p
    LEFT JOIN LATERAL (
      SELECT ca.subscriber_id, ca.predicted_retained_clv_usd
      FROM app.care_actions ca
      WHERE ca.subscriber_id = p.subscriber_id
      ORDER BY ca.created_at DESC
      LIMIT 1
    ) la ON TRUE
  `);
  const row = toRows<Record<string, string | number>>(result)[0] ?? {};
  const num = (v: unknown) => Number(v ?? 0);
  return {
    total_at_risk: num(row.total_at_risk),
    total_critical: num(row.total_critical),
    total_elevated: num(row.total_elevated),
    total_watch: num(row.total_watch),
    total_actioned: num(row.total_actioned),
    total_clv_at_risk_usd: num(row.total_clv_at_risk_usd),
    total_clv_saved_usd: num(row.total_clv_saved_usd),
  };
}

/** Per-metro aggregation for the care-desk map — one bubble per home metro. */
export async function metroBuckets(db: AppDb): Promise<MetroBucket[]> {
  const result = await db.execute(sql`
    SELECT
      p.home_metro                     AS metro,
      AVG(p.sub_lat)                   AS lat,
      AVG(p.sub_lng)                   AS lng,
      COUNT(*)                         AS count,
      COUNT(la.subscriber_id)          AS actioned,
      COALESCE(SUM(p.clv_at_risk_usd), 0) AS clv_at_risk_usd
    FROM app.subscriber_position p
    LEFT JOIN LATERAL (
      SELECT ca.subscriber_id
      FROM app.care_actions ca
      WHERE ca.subscriber_id = p.subscriber_id
      ORDER BY ca.created_at DESC
      LIMIT 1
    ) la ON TRUE
    WHERE p.risk_band <> 'healthy'
      AND p.home_metro IS NOT NULL
      AND p.sub_lat IS NOT NULL
      AND p.sub_lng IS NOT NULL
    GROUP BY p.home_metro
    ORDER BY clv_at_risk_usd DESC
  `);
  return toRows<Record<string, string | number>>(result).map((r) => ({
    metro: String(r.metro),
    lat: Number(r.lat),
    lng: Number(r.lng),
    count: Number(r.count),
    actioned: Number(r.actioned),
    clv_at_risk_usd: Number(r.clv_at_risk_usd),
  }));
}

// ── Activity feed (Home) ─────────────────────────────────────────────────────

/** Most recent care actions, enriched with subscriber metro/plan. */
export async function recentActivity(
  db: AppDb,
  limit = 20,
): Promise<CareActivity[]> {
  const result = await db.execute(sql`
    SELECT
      ca.id                          AS action_id,
      ca.subscriber_id               AS subscriber_id,
      ca.offer_type                  AS offer_type,
      ca.status                      AS status,
      ca.approved_by                 AS approved_by,
      ca.predicted_retained_clv_usd  AS predicted_retained_clv_usd,
      ca.drafted_summary             AS drafted_summary,
      p.home_metro                   AS home_metro,
      p.plan_type                    AS plan_type,
      COALESCE(ca.decided_at, ca.created_at) AS at
    FROM app.care_actions ca
    LEFT JOIN app.subscriber_position p ON p.subscriber_id = ca.subscriber_id
    ORDER BY COALESCE(ca.decided_at, ca.created_at) DESC
    LIMIT ${limit}
  `);
  return toRows<CareActivity>(result);
}

// ── Subscriber detail (drawer) ───────────────────────────────────────────────

/**
 * Full subscriber view for the detail drawer: current position, ML
 * recommendation (with the ranked-offer breakdown), and every care action
 * with its lifecycle timeline.
 */
export async function subscriberDetail(
  db: AppDb,
  subscriberId: string,
): Promise<SubscriberDetail | null> {
  const posResult = await db.execute(sql`
    SELECT
      p.subscriber_id, p.plan_type, p.tenure_months, p.monthly_arpu_usd,
      p.service_node_id, p.home_metro, p.sub_lat, p.sub_lng, p.service_summary,
      p.churn_risk_score, p.churn_reason, p.open_ticket_count, p.has_open_outage,
      p.has_open_billing, p.churn_signal_score, p.clv_at_risk_usd, p.risk_band,
      r.recommended_offer, r.predicted_retained_clv_usd, r.predicted_net_value_usd,
      r.offer_ranking
    FROM app.subscriber_position p
    LEFT JOIN app.retention_recommendations r ON r.subscriber_id = p.subscriber_id
    WHERE p.subscriber_id = ${subscriberId}
    LIMIT 1
  `);
  const pos = toRows<Record<string, unknown>>(posResult)[0];
  if (!pos) return null;

  const actionsResult = await db.execute(sql`
    SELECT
      ca.id AS action_id, ca.offer_type, ca.offer_id, ca.status, ca.approved_by,
      ca.predicted_retained_clv_usd, ca.drafted_summary, ca.created_at, ca.decided_at
    FROM app.care_actions ca
    WHERE ca.subscriber_id = ${subscriberId}
    ORDER BY ca.created_at DESC
  `);
  const actionRows = toRows<Record<string, unknown>>(actionsResult);

  const eventsResult = await db.execute(sql`
    SELECT e.event_id, e.action_id, e.event_type, e.actor_email, e.notes, e.created_at AS at
    FROM app.care_action_events e
    JOIN app.care_actions ca ON ca.id = e.action_id
    WHERE ca.subscriber_id = ${subscriberId}
    ORDER BY e.created_at ASC
  `);
  const eventRows = toRows<{ action_id: string } & CareActionTimelineEntry>(eventsResult);
  const timelineByAction = new Map<string, CareActionTimelineEntry[]>();
  for (const e of eventRows) {
    const list = timelineByAction.get(e.action_id) ?? [];
    list.push({ event_id: e.event_id, event_type: e.event_type, actor_email: e.actor_email, notes: e.notes, at: e.at });
    timelineByAction.set(e.action_id, list);
  }

  const asNum = (v: unknown) => (v == null ? null : Number(v));
  return {
    subscriber_id: String(pos.subscriber_id),
    plan_type: (pos.plan_type as string) ?? null,
    tenure_months: asNum(pos.tenure_months),
    monthly_arpu_usd: asNum(pos.monthly_arpu_usd),
    service_node_id: (pos.service_node_id as string) ?? null,
    home_metro: (pos.home_metro as string) ?? null,
    sub_lat: asNum(pos.sub_lat),
    sub_lng: asNum(pos.sub_lng),
    service_summary: (pos.service_summary as string) ?? null,
    churn_risk_score: asNum(pos.churn_risk_score),
    churn_reason: (pos.churn_reason as string) ?? null,
    open_ticket_count: asNum(pos.open_ticket_count),
    has_open_outage: (pos.has_open_outage as boolean) ?? null,
    has_open_billing: (pos.has_open_billing as boolean) ?? null,
    churn_signal_score: asNum(pos.churn_signal_score),
    clv_at_risk_usd: asNum(pos.clv_at_risk_usd),
    risk_band: String(pos.risk_band ?? 'healthy'),
    recommended_offer: (pos.recommended_offer as string) ?? null,
    predicted_retained_clv_usd: asNum(pos.predicted_retained_clv_usd),
    predicted_net_value_usd: asNum(pos.predicted_net_value_usd),
    offer_ranking: pos.offer_ranking ?? [],
    actions: actionRows.map((a) => ({
      action_id: String(a.action_id),
      offer_type: String(a.offer_type),
      offer_id: (a.offer_id as string) ?? null,
      status: String(a.status),
      approved_by: (a.approved_by as string) ?? null,
      predicted_retained_clv_usd: asNum(a.predicted_retained_clv_usd),
      drafted_summary: (a.drafted_summary as string) ?? null,
      created_at: String(a.created_at),
      decided_at: (a.decided_at as string) ?? null,
      timeline: timelineByAction.get(String(a.action_id)) ?? [],
    })),
  };
}

// ── Write: care lead decides on a subscriber from the queue ──────────────────

/**
 * Record a care-desk decision made directly in the Operations UI (not via the
 * agent). Mirrors `recordRetentionAction` in subscribers.ts but lets a care
 * lead approve/apply an offer or decline retention from the drawer. Transactional:
 * inserts the care action + an append-only lifecycle event.
 */
export async function decideCareAction(
  db: AppDb,
  args: {
    subscriberId: string;
    decision: 'approved' | 'declined';
    offerType: 'bill_credit' | 'plan_upgrade_discount' | 'device_upgrade';
    offerId?: string | null;
    predictedRetainedClvUsd?: number | null;
    notes?: string;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  return db.transaction(async (tx) => {
    const agent = await tx.select({ id: careAgents.agentId }).from(careAgents).limit(1);
    const now = new Date().toISOString();
    const status = args.decision === 'approved' ? 'approved' : 'declined';
    const inserted = await tx
      .insert(careActions)
      .values({
        subscriberId: args.subscriberId,
        agentId: agent[0]?.id ?? null,
        offerType: args.offerType,
        offerId: args.offerId ?? null,
        draftedSummary: args.notes ?? null,
        predictedRetainedClvUsd: args.predictedRetainedClvUsd ?? undefined,
        status,
        approvedBy: args.userEmail,
        decidedAt: new Date(),
        auditTrail: [
          { at: now, by: args.userEmail, action: status, notes: args.notes, tool: 'care_desk_ui' },
        ],
      })
      .returning({ id: careActions.id });
    const actionId = inserted[0].id;
    await tx.insert(careActionEvents).values({
      actionId,
      eventType: status,
      actorEmail: args.userEmail,
      notes: args.notes ?? `Retention offer ${status} via Care Desk`,
    });
    return { actionId };
  });
}
