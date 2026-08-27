-- Streamline Telco — SDP Silver layer
-- Reads the 8 raw parquet datasets from the UC Volume via read_files() (no bronze), joins +
-- rolls up + runs the ai_classify churn-signal showcase (deduped). See specifications/01-lakeflow.md §B.
--
-- Pipeline is configured with { catalog, schema } so ${catalog}/${schema} resolve the Volume path
-- /Volumes/<catalog>/<schema>/raw_data/<dataset>. Everything here is a Materialized View: the raw
-- data is static parquet, so batch read_files() MVs recompute fully + deterministically each run.

-- ─────────────────────────────────────────────────────────────────────────────
-- note_churn_flags — the ai_classify showcase, DEDUPED.
-- The note pool is tiny (~7 distinct strings across ~42K snapshot rows), so we classify each
-- DISTINCT note exactly once, then silver_risk joins the score back. ai_classify is called ~7×
-- instead of ~42K× — the whole point of the dedup MV.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW note_churn_flags
  COMMENT 'Distinct agent notes classified once by ai_classify → churn_signal_score (1.0/0.6/0.1).'
AS
WITH distinct_notes AS (
  SELECT DISTINCT agent_note_text
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/risk_snapshots', format => 'parquet')
  WHERE agent_note_text IS NOT NULL
),
classified AS (
  SELECT
    agent_note_text,
    ai_classify(agent_note_text, ARRAY('churn_signal', 'at_risk', 'healthy')) AS note_class
  FROM distinct_notes
)
SELECT
  agent_note_text,
  note_class,
  CASE note_class
    WHEN 'churn_signal' THEN 1.0
    WHEN 'at_risk'      THEN 0.6
    ELSE 0.1
  END AS churn_signal_score
FROM classified;

-- ─────────────────────────────────────────────────────────────────────────────
-- silver_tickets — per-subscriber ticket rollup (open counts + open-outage / open-billing flags).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW silver_tickets
  COMMENT 'Per-subscriber ticket rollup: open_ticket_count, has_open_outage/billing, latest type.'
AS
SELECT
  subscriber_id,
  COUNT(*)                                                                          AS ticket_count,
  SUM(CASE WHEN closed_date IS NULL THEN 1 ELSE 0 END)                              AS open_ticket_count,
  COALESCE(BOOL_OR(closed_date IS NULL AND ticket_type = 'outage'),  false)         AS has_open_outage,
  COALESCE(BOOL_OR(closed_date IS NULL AND ticket_type = 'billing'), false)         AS has_open_billing,
  MAX_BY(ticket_type, opened_date)                                                  AS latest_ticket_type
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/tickets', format => 'parquet')
GROUP BY subscriber_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- silver_billing — per-subscriber billing rollup: recent-dispute flag + last dispute reason.
-- "Recent" = a disputed bill in the last 120 days (the affected cohort's disputes land in the
-- current billing month; baseline disputes are scattered across 18 months).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW silver_billing
  COMMENT 'Per-subscriber billing rollup: has_recent_dispute + last dispute reason.'
AS
SELECT
  subscriber_id,
  COALESCE(BOOL_OR(disputed AND bill_month >= date_sub(current_date(), 120)), false) AS has_recent_dispute,
  MAX_BY(dispute_reason, bill_month) FILTER (WHERE disputed)                         AS last_dispute_reason
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/billing', format => 'parquet')
GROUP BY subscriber_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- silver_risk — daily risk position denormalized with the subscriber master + the note churn
-- score. Carries the full ~14-day history (drives the Analytics risk-trend chart); gold picks the
-- current snapshot. Clustered by snapshot_date for the trend reads.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW silver_risk
  CLUSTER BY (snapshot_date)
  COMMENT 'Daily churn-risk snapshots joined to the subscriber master + ai_classify note score.'
AS
SELECT
  r.subscriber_id,
  r.snapshot_date,
  r.churn_risk_score,
  r.churn_reason,
  r.open_ticket_count AS snapshot_open_ticket_count,
  r.agent_note_text,
  s.plan_type,
  s.tenure_months,
  s.monthly_arpu_usd,
  s.service_node_id,
  s.home_metro,
  s.state,
  s.sub_lat,
  s.sub_lng,
  s.service_summary,
  COALESCE(n.churn_signal_score, 0.1) AS churn_signal_score
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/risk_snapshots', format => 'parquet') r
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/subscribers', format => 'parquet') s
  ON r.subscriber_id = s.subscriber_id
LEFT JOIN note_churn_flags n
  ON r.agent_note_text = n.agent_note_text;

-- ─────────────────────────────────────────────────────────────────────────────
-- silver_retention — 18-month retention-offer history (the model / heuristic training signal).
-- Pass-through of the labeled outcomes with the features gold_retention_outcomes needs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REFRESH MATERIALIZED VIEW silver_retention
  COMMENT 'Retention-offer history with outcomes — one row per historical offer.'
AS
SELECT
  retention_id,
  subscriber_id,
  offer_type,
  churn_reason,
  monthly_arpu_usd,
  initiated_date,
  offer_cost_usd,
  retained,
  retained_clv_usd
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/retention_offers', format => 'parquet');
