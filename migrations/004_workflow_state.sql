-- Migration: 004_workflow_state
-- Author: Isaac (Claude Code coding agent)
-- Co-authored-by: Isaac <no-reply@databricks.com>
--
-- Milestone 3 (Build 2) — workflow-state + observability table for the Care Desk app.
-- Records (a) TRIGGER events (a schedule or system update that re-scores the live view) and
-- (b) recorded DECISIONS (a care action was proposed / approved / committed), each with a
-- timestamp and a link to the care_actions row it concerns. This is the app's closed-loop
-- audit trail: Layer 1 writes trigger events, Layer 3 writes decision events.

CREATE TABLE IF NOT EXISTS public.workflow_state (
    event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_kind    TEXT NOT NULL CHECK (event_kind IN ('trigger', 'decision')),
    event_type    TEXT NOT NULL,          -- e.g. 'view_scored', 'action_proposed', 'action_approved', 'action_committed'
    source        TEXT NOT NULL,          -- 'schedule' | 'system_update' | 'app_user'
    subscriber_id TEXT,                    -- the subscriber the event concerns (nullable for a whole-view scoring)
    action_id     UUID REFERENCES public.care_actions (id) ON DELETE SET NULL,
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- counts scored, risk numbers, approver, etc.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_state_kind ON public.workflow_state (event_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_state_subscriber ON public.workflow_state (subscriber_id);
