-- Daily CLV-at-risk trend (last 30 days) — Streamline Telco.
-- The dollar value that could walk each day: for every snapshot, sum the
-- CLV-at-risk (ARPU × 24-month horizon × risk) of subscribers whose churn
-- risk crossed the at-risk threshold (>= 0.6). Tracks the outage crisis
-- surfacing over the window — the same clv_at_risk_usd measure the app and
-- gold_subscriber_position use, computed here from the daily silver_risk
-- snapshots so the trend has one point per day.
-- Referenced via IDENTIFIER(:catalog || '.' || :schema || '.t') so the query
-- resolves on any workspace; :catalog/:schema are bound at runtime by
-- charts.ts and sampled at typegen via the @param annotations below.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
SELECT
  snapshot_date AS return_date,
  CAST(ROUND(SUM(
    CASE WHEN churn_risk_score >= 0.6
         THEN monthly_arpu_usd * 24 * churn_risk_score
         ELSE 0 END
  ), 0) AS DOUBLE) AS clv_at_risk_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_risk')
WHERE snapshot_date >= date_sub(current_date(), 30)
GROUP BY snapshot_date
ORDER BY snapshot_date
