-- At-risk book by plan type — Streamline Telco.
-- How the current at-risk CLV splits across plan_type (mobile / bundle /
-- broadband): subscriber count + total CLV-at-risk per plan. Reads the
-- governed current at-risk book (gold_open_atrisk).
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  plan_type,
  CAST(COUNT(*) AS BIGINT) AS subscriber_count,
  CAST(ROUND(SUM(clv_at_risk_usd), 0) AS DOUBLE) AS clv_at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk')
GROUP BY plan_type
ORDER BY clv_at_risk_usd DESC
