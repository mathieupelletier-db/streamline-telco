-- Validation query for the agent's change (run on PRODUCTION after promotion).
-- Confirms the new care_action_metrics view resolves and rolls up the seeded care actions.
SELECT offer_type, status, action_count, subscribers,
       total_predicted_retained_clv_usd, avg_predicted_retained_clv_usd
FROM public.care_action_metrics
ORDER BY offer_type, status;
