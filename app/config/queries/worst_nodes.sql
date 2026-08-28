-- Worst service nodes by at-risk rate — Streamline Telco.
-- The network analog of "worst production lots": for each service node, what
-- share of its subscribers are in the at-risk book, and how much CLV that is.
-- subscriber totals come from gold_subscriber_position (every subscriber on
-- the node); the at-risk aggregates come from gold_open_atrisk (the current
-- critical/elevated/watch book). Nodes with a 100% at-risk rate are the outage
-- epicenter — the pattern the analytics page exists to surface.
-- Every table is referenced via IDENTIFIER(:catalog || '.' || :schema || '.t')
-- so the query resolves on any workspace; :catalog/:schema are bound at runtime
-- and sampled at typegen via the @param annotations below.
-- @param catalog STRING = ai_demo_gen
-- @param schema STRING = streamline_telco
WITH node_all AS (
  SELECT service_node_id, COUNT(*) AS subscribers
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_subscriber_position')
  GROUP BY service_node_id
),
node_risk AS (
  SELECT
    service_node_id,
    COUNT(*)              AS atrisk_count,
    SUM(clv_at_risk_usd)  AS clv_at_risk_usd,
    MAX(home_metro)       AS home_metro
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_open_atrisk')
  GROUP BY service_node_id
)
SELECT
  r.service_node_id,
  r.home_metro,
  CAST(a.subscribers AS BIGINT)     AS subscribers,
  CAST(r.atrisk_count AS BIGINT)    AS atrisk_count,
  CAST(ROUND(r.atrisk_count * 100.0 / a.subscribers, 1) AS DOUBLE) AS atrisk_rate_pct,
  CAST(ROUND(r.clv_at_risk_usd, 0) AS DOUBLE) AS clv_at_risk_usd
FROM node_risk r
JOIN node_all a ON r.service_node_id = a.service_node_id
ORDER BY atrisk_rate_pct DESC, clv_at_risk_usd DESC
LIMIT 20
