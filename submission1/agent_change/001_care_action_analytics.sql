-- Migration: 001_care_action_analytics
-- Author: Isaac (Claude Code coding agent)
-- Co-authored-by: Isaac <no-reply@databricks.com>
--
-- Purpose: add an operational analytics layer on top of the app's writable care_actions table so
-- Rae can see save-rate + retained-CLV per offer type without leaving Postgres. Adds a generated
-- column + a rollup view. Authored by the coding agent on the `dev` branch, validated there, then
-- promoted to `production`.

-- 1. Schema change: tag each care action with the ISO year+week it was decided, for weekly
--    save-rate reporting. Plain column + backfill (a generated column can't use EXTRACT on
--    timestamptz — that expression is only STABLE, not IMMUTABLE). The app stamps it on write;
--    this migration backfills existing rows.
ALTER TABLE public.care_actions
    ADD COLUMN IF NOT EXISTS decided_week TEXT;

UPDATE public.care_actions
   SET decided_week = to_char(COALESCE(decided_at, created_at), 'IYYY-"W"IW')
 WHERE decided_week IS NULL;

-- 2. Analytics view: retained CLV + action counts per offer type and status.
CREATE OR REPLACE VIEW public.care_action_metrics AS
SELECT
    offer_type,
    status,
    COUNT(*)                                              AS action_count,
    COUNT(DISTINCT subscriber_id)                         AS subscribers,
    ROUND(SUM(predicted_retained_clv_usd)::numeric, 2)    AS total_predicted_retained_clv_usd,
    ROUND(AVG(predicted_retained_clv_usd)::numeric, 2)    AS avg_predicted_retained_clv_usd
FROM public.care_actions
GROUP BY offer_type, status;
