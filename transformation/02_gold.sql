-- Streamline Telco — SDP Gold layer
-- Aggregates silver into the governed gold tables the dashboard, metric view, Genie, and app read.
-- See specifications/01-lakeflow.md §B (Silver → Gold). Every dashboard aggregate carries
-- plan_type, churn_reason, risk_band (the dashboard-filter contract).

-- ─────────────────────────────────────────────────────────────────────────────
-- gold_subscriber_position — THE HEART. One row per subscriber at the CURRENT snapshot, with
-- plan/geo dims, tickets, billing, risk, reason, the derived CLV-at-risk measure + the risk_band.
-- The coherence spine: dashboard scatter/map, metric view, Genie, and the app all read this.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW gold_subscriber_position
  COMMENT 'Current per-subscriber position: plan, geo, risk, reason, tickets, CLV-at-risk, risk_band.'
AS
WITH current_risk AS (
  -- Each subscriber's latest snapshot = the "current" position (SNAPSHOT_DATE for all rows).
  SELECT *
  FROM (
    SELECT r.*,
           ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY snapshot_date DESC) AS rn
    FROM silver_risk r
  )
  WHERE rn = 1
)
SELECT
  c.subscriber_id,
  c.plan_type,
  c.tenure_months,
  c.monthly_arpu_usd,
  c.service_node_id,
  c.home_metro,
  c.state,
  c.sub_lat,
  c.sub_lng,
  c.service_summary,
  c.churn_risk_score,
  c.churn_reason,
  COALESCE(t.open_ticket_count, 0)                 AS open_ticket_count,
  COALESCE(t.has_open_outage, false)               AS has_open_outage,
  COALESCE(t.has_open_billing, false)              AS has_open_billing,
  COALESCE(b.has_recent_dispute, false)            AS has_recent_dispute,
  c.churn_signal_score,
  -- CLV that could walk: ARPU × 24-month horizon × risk, only for at-risk subscribers (>= 0.6).
  ROUND(CASE WHEN c.churn_risk_score >= 0.6
             THEN c.monthly_arpu_usd * 24 * c.churn_risk_score ELSE 0 END, 2) AS clv_at_risk_usd,
  CASE
    WHEN c.churn_risk_score >= 0.75 AND COALESCE(t.open_ticket_count, 0) > 0 THEN 'critical'
    WHEN c.churn_risk_score >= 0.6                                          THEN 'elevated'
    WHEN c.churn_risk_score >= 0.4                                          THEN 'watch'
    ELSE 'healthy'
  END                                              AS risk_band
FROM current_risk c
LEFT JOIN silver_tickets t ON c.subscriber_id = t.subscriber_id
LEFT JOIN silver_billing b ON c.subscriber_id = b.subscriber_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- gold_open_atrisk — the current at-risk book (critical/elevated/watch), enriched with the
-- candidate offer that matches each subscriber's churn reason. Model scoring input + the app's
-- care queue. candidate_offer_id maps reason → a representative offer of the matching type.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW gold_open_atrisk
  COMMENT 'Current at-risk subscribers + reason + a candidate offer of the matching type.'
AS
WITH offer_by_type AS (
  -- One representative offer_id per offer_type (the lowest id of that type).
  SELECT offer_type, MIN(offer_id) AS offer_id
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/offers', format => 'parquet')
  GROUP BY offer_type
)
SELECT
  p.subscriber_id,
  p.plan_type,
  p.tenure_months,
  p.monthly_arpu_usd,
  p.service_node_id,
  p.home_metro,
  p.sub_lat,
  p.sub_lng,
  p.churn_risk_score,
  p.clv_at_risk_usd,
  p.churn_reason,
  p.has_open_outage,
  p.has_open_billing,
  -- reason → matching candidate offer: service→bill_credit, price→plan_upgrade_discount, device→device_upgrade
  o.offer_id AS candidate_offer_id
FROM gold_subscriber_position p
LEFT JOIN offer_by_type o
  ON o.offer_type = CASE p.churn_reason
                      WHEN 'service' THEN 'bill_credit'
                      WHEN 'price'   THEN 'plan_upgrade_discount'
                      WHEN 'device'  THEN 'device_upgrade'
                    END
WHERE p.risk_band IN ('critical', 'elevated', 'watch');

-- ─────────────────────────────────────────────────────────────────────────────
-- gold_retention_outcomes — the retention-offer history, one row per offer. The heuristic's
-- coefficient source + the OPTIONAL ML training table (03-ml-churn.md).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW gold_retention_outcomes
  COMMENT 'Retention-offer history with outcomes — training signal for heuristic + optional ML.'
AS
SELECT
  retention_id,
  subscriber_id,
  offer_type,
  churn_reason,
  monthly_arpu_usd,
  offer_cost_usd,
  retained,
  retained_clv_usd
FROM silver_retention;

-- ─────────────────────────────────────────────────────────────────────────────
-- gold_retention_recommendations — the ranked offer per open at-risk subscriber, built by the
-- pipeline HEURISTIC (ML optional). For each subscriber, construct the three candidate offers and
-- rank by net value = retained_clv − offer_cost, where P(retain) depends on whether the offer
-- MATCHES the churn reason. Columns match 03-ml-churn.md's inference shape so the ML step can
-- overwrite this table with nothing downstream changing.
--
-- Because the current at-risk book is entirely service-reason, bill_credit wins across the book
-- (incl. the hero SUB-0000214) — but all three offers are ranked, so the logic is fully exercised.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW gold_retention_recommendations
  COMMENT 'Ranked retention offer per at-risk subscriber (heuristic net-value ranking).'
AS
WITH candidates AS (
  SELECT
    subscriber_id,
    churn_reason,
    clv_at_risk_usd,
    -- bill_credit: P=0.7 if service else 0.3; one-time credit, cost ≈ 40
    ROUND(clv_at_risk_usd * (CASE WHEN churn_reason = 'service' THEN 0.7 ELSE 0.3 END), 2)  AS clv_credit,
    40.0                                                                                     AS cost_credit,
    -- plan_upgrade_discount: P=0.65 if price else 0.3; recurring discount, cost ≈ arpu × 0.2 × 12
    ROUND(clv_at_risk_usd * (CASE WHEN churn_reason = 'price' THEN 0.65 ELSE 0.3 END), 2)   AS clv_plan,
    ROUND(monthly_arpu_usd * 0.2 * 12, 2)                                                    AS cost_plan,
    -- device_upgrade: P=0.6 if device else 0.25; subsidized device, cost ≈ 300
    ROUND(clv_at_risk_usd * (CASE WHEN churn_reason = 'device' THEN 0.6 ELSE 0.25 END), 2)  AS clv_device,
    300.0                                                                                    AS cost_device
  FROM gold_open_atrisk
),
nets AS (
  SELECT *,
    ROUND(clv_credit - cost_credit, 2) AS net_credit,
    ROUND(clv_plan   - cost_plan,   2) AS net_plan,
    ROUND(clv_device - cost_device, 2) AS net_device
  FROM candidates
),
ranked AS (
  SELECT *,
    CASE
      WHEN net_credit >= net_plan AND net_credit >= net_device THEN 'bill_credit'
      WHEN net_plan   >= net_device                            THEN 'plan_upgrade_discount'
      ELSE 'device_upgrade'
    END AS recommended_offer
  FROM nets
)
SELECT
  subscriber_id,
  recommended_offer,
  CASE recommended_offer
    WHEN 'bill_credit'           THEN clv_credit
    WHEN 'plan_upgrade_discount' THEN clv_plan
    ELSE clv_device
  END AS predicted_retained_clv_usd,
  CASE recommended_offer
    WHEN 'bill_credit'           THEN net_credit
    WHEN 'plan_upgrade_discount' THEN net_plan
    ELSE net_device
  END AS predicted_net_value_usd,
  -- All three options, sorted by net value DESC — the app quotes these + runs the what-if.
  TO_JSON(ARRAY_SORT(
    ARRAY(
      NAMED_STRUCT('offerType', 'bill_credit',           'costUsd', cost_credit, 'predictedRetainedClvUsd', clv_credit, 'predictedNetValueUsd', net_credit),
      NAMED_STRUCT('offerType', 'plan_upgrade_discount', 'costUsd', cost_plan,   'predictedRetainedClvUsd', clv_plan,   'predictedNetValueUsd', net_plan),
      NAMED_STRUCT('offerType', 'device_upgrade',        'costUsd', cost_device, 'predictedRetainedClvUsd', clv_device, 'predictedNetValueUsd', net_device)
    ),
    (l, r) -> CASE WHEN l.predictedNetValueUsd > r.predictedNetValueUsd THEN -1
                   WHEN l.predictedNetValueUsd < r.predictedNetValueUsd THEN 1 ELSE 0 END
  )) AS offer_ranking,
  CURRENT_TIMESTAMP() AS scored_at
FROM ranked;
