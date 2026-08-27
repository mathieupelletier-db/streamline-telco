-- Streamline Telco — Metric View: mv_subscriber_risk
-- The ONE governed definition of Streamline's churn-exposure metrics. Dashboard KPI tiles, Genie
-- headline answers, and the app's KPI cards all read these measures. See specifications/02-uc-governance.md.
--
-- Source: gold_subscriber_position (the coherence spine). Measure names are lowercase/no-spaces on
-- purpose — the AI/BI dashboard datasets call MEASURE(`clv_at_risk`) etc. literally.

CREATE OR REPLACE VIEW ai_demo_gen.streamline_telco.mv_subscriber_risk
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: ai_demo_gen.streamline_telco.gold_subscriber_position
comment: "Streamline Telco churn-exposure metrics: the single governed KPI definition over the current subscriber position."
dimensions:
  - name: plan_type
    expr: plan_type
  - name: churn_reason
    expr: churn_reason
  - name: risk_band
    expr: risk_band
  - name: home_metro
    expr: home_metro
  - name: service_node_id
    expr: service_node_id
  - name: subscriber_id
    expr: subscriber_id
measures:
  - name: clv_at_risk
    expr: SUM(clv_at_risk_usd)
  - name: open_tickets
    expr: SUM(open_ticket_count)
  - name: subscriber_count
    expr: COUNT(1)
  - name: critical_count
    expr: SUM(CASE WHEN risk_band = 'critical' THEN 1 ELSE 0 END)
  - name: elevated_count
    expr: SUM(CASE WHEN risk_band = 'elevated' THEN 1 ELSE 0 END)
  - name: atrisk_count
    expr: SUM(CASE WHEN risk_band IN ('critical','elevated') THEN 1 ELSE 0 END)
  - name: avg_churn_risk
    expr: AVG(churn_risk_score)
  - name: avg_churn_signal
    expr: AVG(churn_signal_score)
$$;
