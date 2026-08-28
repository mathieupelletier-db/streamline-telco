-- At-risk subscribers by churn reason (service / price / device).
-- Powers the Analytics page's "why they're leaving" breakdown.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  churn_reason,
  COUNT(*) AS atrisk_count,
  CAST(ROUND(SUM(clv_at_risk_usd), 2) AS DOUBLE) AS clv_at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk')
WHERE churn_reason IS NOT NULL
GROUP BY churn_reason
ORDER BY atrisk_count DESC
