-- Query against the synced Unity Catalog table (Lakebase read-only mirror of
-- ai_demo_gen.streamline_telco.gold_subscriber_position, synced into Postgres as
-- streamline_lakebase.public.subscriber_position). Returns the at-risk book joined to
-- the model's ranked retention offer — the rows the Care Desk app serves at low latency.
SELECT p.subscriber_id, p.plan_type, p.tenure_months, p.home_metro,
       p.churn_risk_score, p.churn_reason, p.risk_band, p.clv_at_risk_usd,
       r.recommended_offer, r.predicted_retained_clv_usd
FROM public.subscriber_position p
JOIN public.retention_recommendations r ON p.subscriber_id = r.subscriber_id
WHERE p.risk_band IN ('critical','elevated')
ORDER BY p.clv_at_risk_usd DESC
LIMIT 10;
