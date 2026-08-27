-- The Care Desk queue (Layer 1 Visualize) — reads the read-only synced mirrors
-- (app.subscriber_position ⋈ app.retention_recommendations) and LEFT JOINs each subscriber's
-- latest writable app.care_actions row, so a committed decision shows on the next read (closed loop).
-- Ranked: open/unactioned first, then by CLV at risk descending.
SELECT p.subscriber_id, p.plan_type, p.home_metro, p.churn_risk_score, p.churn_reason,
       p.risk_band, p.clv_at_risk_usd,
       r.recommended_offer, r.predicted_retained_clv_usd,
       latest.status AS action_status, latest.offer_type AS applied_offer
FROM app.subscriber_position p
JOIN app.retention_recommendations r ON p.subscriber_id = r.subscriber_id
LEFT JOIN LATERAL (
    SELECT status, offer_type FROM app.care_actions ca
    WHERE ca.subscriber_id = p.subscriber_id ORDER BY ca.created_at DESC LIMIT 1
) latest ON true
WHERE p.risk_band IN ('critical','elevated')
ORDER BY (latest.status IS NOT NULL), p.clv_at_risk_usd DESC;
