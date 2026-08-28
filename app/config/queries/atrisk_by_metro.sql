-- At-risk book by metro — Streamline Telco.
-- Where the at-risk CLV is concentrated geographically: subscriber count +
-- total CLV-at-risk per home_metro. Reads the governed current at-risk book
-- (gold_open_atrisk). Surfaces the outage's metro footprint.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  home_metro,
  CAST(COUNT(*) AS BIGINT) AS subscriber_count,
  CAST(ROUND(SUM(clv_at_risk_usd), 0) AS DOUBLE) AS clv_at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk')
GROUP BY home_metro
ORDER BY clv_at_risk_usd DESC
