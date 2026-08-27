/**
 * Streamline Telco subscriber + care-action queries.
 *
 * Build-2/3 implementations wired to the Lakebase `app.*` tables. These back the
 * caredesk.ts agent tools (find_atrisk_subscriber, rank_offers, search_history,
 * execute_retention_action). Read helpers hit the read-only synced mirrors
 * (subscriber_position, open_atrisk, retention_recommendations); the ONLY write is
 * recordRetentionAction → the writable care_actions table.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  subscriberPosition,
  openAtrisk,
  retentionRecommendations,
  careActions,
  careAgents,
  careActionEvents,
  type OfferOption,
} from '../schema.js';

export type AtriskSubscriber = {
  subscriberId: string;
  planType: string | null;
  monthlyArpuUsd: number | null;
  churnRiskScore: number | null;
  churnReason: string | null;
  hasOpenOutage: boolean | null;
  hasOpenBilling: boolean | null;
  clvAtRiskUsd: number | null;
  candidateOfferId: string | null;
};

export type SubscriberRow = typeof subscriberPosition.$inferSelect;

export type RetentionRecommendation = {
  subscriberId: string;
  recommendedOffer: string | null;
  predictedRetainedClvUsd: number | null;
  predictedNetValueUsd: number | null;
  offerRanking: OfferOption[];
};

// ── Build 2 · Assist ─────────────────────────────────────────────────────────

/** Read the at-risk position for a subscriber from app.open_atrisk. */
export async function getAtriskSubscriber(
  db: AppDb,
  subscriberId: string,
): Promise<AtriskSubscriber | null> {
  const rows = await db
    .select()
    .from(openAtrisk)
    .where(eq(openAtrisk.subscriberId, subscriberId))
    .limit(1);
  return (rows[0] as AtriskSubscriber) ?? null;
}

/** The worst open at-risk subscriber by CLV at risk. */
export async function worstAtriskSubscriber(
  db: AppDb,
): Promise<AtriskSubscriber | null> {
  const rows = await db
    .select()
    .from(openAtrisk)
    .orderBy(desc(openAtrisk.clvAtRiskUsd))
    .limit(1);
  return (rows[0] as AtriskSubscriber) ?? null;
}

/** The live per-subscriber position (risk, reason, tickets, geo, CLV). */
export async function getSubscriberPosition(
  db: AppDb,
  subscriberId: string,
): Promise<SubscriberRow | null> {
  const rows = await db
    .select()
    .from(subscriberPosition)
    .where(eq(subscriberPosition.subscriberId, subscriberId))
    .limit(1);
  return rows[0] ?? null;
}

/** The ML model's ranked retention recommendation for a subscriber. */
export async function getRecommendation(
  db: AppDb,
  subscriberId: string,
): Promise<RetentionRecommendation | null> {
  const rows = await db
    .select()
    .from(retentionRecommendations)
    .where(eq(retentionRecommendations.subscriberId, subscriberId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    subscriberId: r.subscriberId,
    recommendedOffer: r.recommendedOffer,
    predictedRetainedClvUsd: r.predictedRetainedClvUsd,
    predictedNetValueUsd: r.predictedNetValueUsd,
    offerRanking: (r.offerRanking as OfferOption[]) ?? [],
  };
}

/**
 * Lakebase Search over the subscriber's service history — BM25 via the
 * lakebase_text extension (lakebase_bm25 access method + to_bm25query + the <@>
 * ranking operator; ascending sort, more-negative = stronger match). Grounds the
 * "why is this subscriber at risk" narrative on their real service history — NOT a
 * separate vector store. Reads the Build-1 search corpus `service_history_search`.
 */
export async function searchHistory(
  db: AppDb,
  subscriberId: string,
  query: string,
  limit = 5,
): Promise<Array<{ subscriberId: string; homeMetro: string | null; serviceSummary: string | null; bm25Score: number }>> {
  const rows = await db.execute(sql`
    SELECT subscriber_id AS "subscriberId", home_metro AS "homeMetro",
           service_summary AS "serviceSummary",
           ROUND((summary_tsv <@> to_bm25query(to_tsvector('english', ${query}),
                  'idx_service_history_bm25'))::numeric, 4) AS "bm25Score"
    FROM public.service_history_search
    WHERE subscriber_id = ${subscriberId}
       OR summary_tsv @@ plainto_tsquery('english', ${query})
    ORDER BY summary_tsv <@> to_bm25query(to_tsvector('english', ${query}), 'idx_service_history_bm25')
    LIMIT ${limit}
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return list as Array<{ subscriberId: string; homeMetro: string | null; serviceSummary: string | null; bm25Score: number }>;
}

// ── Build 3 · Act (the ONLY write) ───────────────────────────────────────────

/**
 * Record an approved retention action to the writable app.care_actions table
 * (+ an append-only care_action_events lifecycle row). Human-in-the-loop: the
 * agent calls this only after the user approves. Transactional.
 */
export async function recordRetentionAction(
  db: AppDb,
  args: {
    subscriberId: string;
    offerType: string;
    offerId: string | null;
    draftedSummary: string;
    predictedRetainedClvUsd: number | null;
    userEmail: string;
  },
): Promise<{ actionId: string }> {
  return db.transaction(async (tx) => {
    const agent = await tx.select({ id: careAgents.agentId }).from(careAgents).limit(1);
    const now = new Date().toISOString();
    const inserted = await tx
      .insert(careActions)
      .values({
        subscriberId: args.subscriberId,
        agentId: agent[0]?.id ?? null,
        offerType: args.offerType as 'bill_credit' | 'plan_upgrade_discount' | 'device_upgrade',
        offerId: args.offerId,
        draftedSummary: args.draftedSummary,
        predictedRetainedClvUsd: args.predictedRetainedClvUsd ?? undefined,
        status: 'approved',
        approvedBy: args.userEmail,
        decidedAt: new Date(),
        auditTrail: [
          { at: now, by: args.userEmail, action: 'approved', tool: 'execute_retention_action' },
        ],
      })
      .returning({ id: careActions.id });
    const actionId = inserted[0].id;
    await tx.insert(careActionEvents).values({
      actionId,
      eventType: 'executed',
      actorEmail: args.userEmail,
      notes: 'Retention action recorded via execute_retention_action',
    });
    return { actionId };
  });
}
