/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/subscribers.ts + server/db/queries/chat.ts.
 *
 * The app is small enough that hand-copying these is simpler than a
 * shared package. If this file grows past ~200 lines, consider a
 * proper shared lib.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING THE TEMPLATE (single most important file to update)
 * ─────────────────────────────────────────────────────────────────────
 * This is the canonical schema for the *domain* — every page, fetch
 * helper, badge, and SQL projection uses what's defined here. When you
 * swap the data model:
 *
 *   1. Replace the entity types below (`SubscriberRow`, `CareActionRow`,
 *      `OfferRow`, etc.) with the shape your demo cares about.
 *   2. Update the matching SQL/Drizzle queries in
 *      `server/db/queries/subscribers.ts` so `/api/...` endpoints return
 *      rows that match the new types. Rename the queries file too.
 *   3. Update the fetch helpers in `client/src/lib/subscribers.ts` (rename
 *      to match your domain — e.g. `lib/turbines.ts`).
 *   4. The string-enum types (`CareActionStatus`, `RiskBand`, etc.)
 *      drive badges in `shared/badges.tsx` — keep those two files aligned.
 *      Adding a new enum value means adding a matching color mapping
 *      in `badges.tsx`.
 *   5. The agent's tool argument schemas in `server/agent/caredesk.ts`
 *      reference these types implicitly (the Zod schemas mirror field names).
 *      Update tool descriptions + Zod shapes when you swap entities.
 *
 * Search the codebase for each type name below to find all references
 * before renaming. There is no compile-time guarantee that SQL projects
 * the right columns — type-checking helps the client side, but the
 * server queries are stringly-typed against the warehouse.
 * ───────────────────────────────────────────────────────────────────── */

export type RiskBand = 'critical' | 'elevated' | 'watch' | 'healthy';
export type ChurnReason = 'service' | 'price' | 'device';
export type OfferType = 'bill_credit' | 'plan_upgrade_discount' | 'device_upgrade';
export type CareActionStatus = 'proposed' | 'approved' | 'executed' | 'declined';

export type SubscriberRow = {
  id: string;
  subscriberId: string;
  planType: string | null;
  tenureMonths: number | null;
  monthlyArpuUsd: number | null;
  serviceNodeId: string | null;
  homeMetro: string | null;
  subLat: number | null;
  subLng: number | null;
  /** Searchable service history (text indexed by Lakebase Search). */
  serviceSummary: string | null;
  churnRiskScore: number | null;
  churnReason: ChurnReason | null;
  openTicketCount: number | null;
  hasOpenOutage: boolean | null;
  hasOpenBilling: boolean | null;
  churnSignalScore: number | null;
  clvAtRiskUsd: number | null;
  riskBand: RiskBand;
};

export type OfferRow = {
  id: string;
  offerId: string;
  offerName: string | null;
  offerType: OfferType | null;
  valueUsd: number | null;
  segment: string | null;
  description: string | null;
  isActive: boolean | null;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'proposed' | 'approved' | 'executed' | 'declined' | 'note';
  notes?: string;
  tool?: string;
};

export type CareActionRow = {
  id: string;
  subscriberId: string;
  offerType: OfferType;
  offerId: string | null;
  draftedSummary: string | null;
  predictedRetainedClvUsd: number | null;
  status: CareActionStatus;
  approvedBy: string | null;
  auditTrail: AuditEntry[];
  createdAt: string;
  decidedAt: string | null;
};

export type CareActionDetail = {
  action_id: string;
  subscriber_id: string;
  offer_type: OfferType;
  offer_id: string | null;
  drafted_summary: string | null;
  predicted_retained_clv_usd: number | null;
  status: CareActionStatus;
  approved_by: string | null;
  audit_trail: AuditEntry[];
  created_at: string;
  decided_at: string | null;
};

// ── Care Desk queue + drawer (telco) ─────────────────────────────────────────
// These mirror the server shapes in server/db/queries/caredesk.ts. The
// Operations page (queue + map + drawer), Home activity feed, and Analytics
// tables all read from here.

/** One row in the care-desk queue: an at-risk subscriber, its ML retention
 *  recommendation, and the latest care action taken on it (if any). */
export type CareQueueRow = {
  subscriberId: string;
  planType: string | null;
  tenureMonths: number | null;
  monthlyArpuUsd: number | null;
  homeMetro: string | null;
  subLat: number | null;
  subLng: number | null;
  churnRiskScore: number | null;
  churnReason: ChurnReason | null;
  riskBand: RiskBand;
  openTicketCount: number | null;
  hasOpenOutage: boolean | null;
  hasOpenBilling: boolean | null;
  clvAtRiskUsd: number | null;
  recommendedOffer: OfferType | null;
  predictedRetainedClvUsd: number | null;
  predictedNetValueUsd: number | null;
  /** null until a care action exists for this subscriber. */
  actionStatus: CareActionStatus | null;
  actionOfferType: OfferType | null;
  actionAt: string | null;
};

/** KPI counts for the top of the care-desk queue. */
export type CareSummary = {
  total_at_risk: number;
  total_critical: number;
  total_elevated: number;
  total_watch: number;
  total_actioned: number;
  total_clv_at_risk_usd: number;
  total_clv_saved_usd: number;
};

/** Per-metro aggregation for the care-desk bubble map. One bubble per home
 *  metro at averaged (lat, lng), sized by at-risk `count`. */
export type MetroBucket = {
  metro: string;
  lat: number;
  lng: number;
  count: number;
  actioned: number;
  clv_at_risk_usd: number;
};

/** One entry in the Home activity feed — a recent care action. */
export type CareActivity = {
  action_id: string;
  subscriber_id: string;
  offer_type: OfferType;
  status: CareActionStatus;
  approved_by: string | null;
  predicted_retained_clv_usd: number | null;
  drafted_summary: string | null;
  home_metro: string | null;
  plan_type: string | null;
  at: string;
};

/** One option in the ML model's ranked offer list. */
export type OfferOption = {
  offerType: OfferType;
  costUsd: number;
  predictedRetainedClvUsd: number;
  predictedNetValueUsd: number;
};

export type CareActionTimelineEntry = {
  event_id: string;
  event_type: string;
  actor_email: string | null;
  notes: string | null;
  at: string;
};

/** A care action as rendered in the subscriber drawer's Activity tab. */
export type SubscriberAction = {
  action_id: string;
  offer_type: OfferType;
  offer_id: string | null;
  status: CareActionStatus;
  approved_by: string | null;
  predicted_retained_clv_usd: number | null;
  drafted_summary: string | null;
  created_at: string;
  decided_at: string | null;
  timeline: CareActionTimelineEntry[];
};

/** Full subscriber view for the detail drawer. */
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
  churn_reason: ChurnReason | null;
  open_ticket_count: number | null;
  has_open_outage: boolean | null;
  has_open_billing: boolean | null;
  churn_signal_score: number | null;
  clv_at_risk_usd: number | null;
  risk_band: RiskBand;
  recommended_offer: OfferType | null;
  predicted_retained_clv_usd: number | null;
  predicted_net_value_usd: number | null;
  offer_ranking: OfferOption[];
  actions: SubscriberAction[];
};
