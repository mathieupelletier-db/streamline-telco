-- Highest-value at-risk subscribers with the ML-recommended retention offer +
-- predicted net value of acting. Powers the Analytics page's "act here first"
-- table. LEFT JOIN so subscribers without a scored recommendation still show.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  a.subscriber_id,
  a.home_metro,
  a.plan_type,
  a.churn_reason,
  CAST(ROUND(a.churn_risk_score, 3) AS DOUBLE) AS churn_risk_score,
  CAST(ROUND(a.clv_at_risk_usd, 2) AS DOUBLE) AS clv_at_risk_usd,
  r.recommended_offer,
  CAST(ROUND(r.predicted_net_value_usd, 2) AS DOUBLE) AS predicted_net_value_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk') a
LEFT JOIN IDENTIFIER(:catalog || '.' || :schema || '.gold_retention_recommendations') r
  ON a.subscriber_id = r.subscriber_id
ORDER BY a.clv_at_risk_usd DESC
LIMIT 20
