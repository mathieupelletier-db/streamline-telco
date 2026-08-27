-- Core retention-exposure question, answered from the synced Lakebase mirrors.
SELECT
    COUNT(*)                                              AS atrisk_subscribers,
    SUM(CASE WHEN p.risk_band = 'critical' THEN 1 ELSE 0 END) AS critical_subscribers,
    ROUND(SUM(p.clv_at_risk_usd)::numeric, 2)             AS total_clv_at_risk_usd,
    r.recommended_offer,
    COUNT(*) FILTER (WHERE r.recommended_offer IS NOT NULL) AS subscribers_for_offer,
    ROUND(SUM(r.predicted_retained_clv_usd)::numeric, 2)  AS total_predicted_retained_clv_usd
FROM public.subscriber_position p
JOIN public.retention_recommendations r ON p.subscriber_id = r.subscriber_id
WHERE p.risk_band IN ('critical','elevated')
GROUP BY r.recommended_offer;
