-- The live view backing Layer 1 (Visualize): the ranked at-risk book. Reads the read-only synced
-- UC tables (subscriber_position, retention_recommendations) and LEFT JOINs each subscriber's
-- latest writable care_actions row so the committed decision shows on the next read (closed loop).
-- Ranked: open/unactioned first, then by CLV at risk descending.
SELECT p.subscriber_id, p.plan_type, p.tenure_months, p.home_metro, p.service_node_id,
       p.churn_risk_score, p.churn_reason, p.risk_band, p.clv_at_risk_usd,
       p.open_ticket_count, p.has_open_outage, p.has_open_billing,
       r.recommended_offer, r.predicted_retained_clv_usd, r.predicted_net_value_usd,
       latest.status AS action_status
FROM public.subscriber_position p
JOIN public.retention_recommendations r ON p.subscriber_id = r.subscriber_id
LEFT JOIN LATERAL (
    SELECT status FROM public.care_actions ca
    WHERE ca.subscriber_id = p.subscriber_id
    ORDER BY ca.created_at DESC LIMIT 1
) latest ON true
WHERE p.risk_band IN ('critical', 'elevated')
ORDER BY (latest.status IS NOT NULL), p.clv_at_risk_usd DESC
LIMIT 20;
