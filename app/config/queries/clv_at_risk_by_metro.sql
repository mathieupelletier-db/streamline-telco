-- CLV at risk + at-risk subscriber count, by home metro.
-- Powers the Analytics page's headline bar chart: where the churn exposure is.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  home_metro,
  COUNT(*) AS atrisk_count,
  CAST(ROUND(SUM(clv_at_risk_usd), 2) AS DOUBLE) AS clv_at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk')
WHERE home_metro IS NOT NULL
GROUP BY home_metro
ORDER BY clv_at_risk_usd DESC
LIMIT 15
