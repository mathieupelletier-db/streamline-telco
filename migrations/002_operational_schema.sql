-- Migration: 002_operational_schema
-- Author: Isaac (Claude Code coding agent)
-- Co-authored-by: Isaac <no-reply@databricks.com>
--
-- Operational (OLTP) schema for the Streamline Telco Care Desk, modeled for the domain as a set
-- of RELATED tables with primary + foreign keys. This is the write surface the app's Act layer
-- operates on. It sits alongside the read-only synced mirrors (subscriber_position, open_atrisk,
-- retention_recommendations, offers) that mirror the governed Delta gold layer.
--
-- Entity-relationship model
-- -------------------------
--   care_agents (1) ──< (N) care_actions (1) ──< (N) care_action_events
--
--   care_agents          — the care leads / SVPs who review + approve retention offers.
--   care_actions         — one row per retention decision on a subscriber (the ONLY table the app
--                          writes on the hot path); references the agent who owns it and the offer
--                          catalog entry chosen. subscriber_id is the natural key into the synced
--                          subscriber_position mirror; offer_id into the synced offers catalog.
--   care_action_events   — append-only lifecycle events for an action (proposed → approved →
--                          executed / declined), normalized out of the JSONB audit_trail so the
--                          history is a first-class, queryable child table with a FK to its action.

-- ---------------------------------------------------------------------------
-- 1. Parent: care_agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.care_agents (
    agent_id     TEXT PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    team         TEXT NOT NULL DEFAULT 'Customer Care & Retention',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. care_actions — relate it to care_agents (add the owning-agent FK).
--    (Table already exists as the app's writable surface; evolve it in place.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.care_actions
    ADD COLUMN IF NOT EXISTS agent_id TEXT;

-- Backfill agent_id from the existing approved_by email via care_agents, then add the FK.
INSERT INTO public.care_agents (agent_id, email, display_name)
SELECT 'AGT-' || upper(substr(md5(approved_by), 1, 6)), approved_by,
       initcap(split_part(split_part(approved_by,'@',1),'.',1) || ' ' || split_part(split_part(approved_by,'@',1),'.',2))
FROM (SELECT DISTINCT approved_by FROM public.care_actions WHERE approved_by IS NOT NULL) a
ON CONFLICT (email) DO NOTHING;

UPDATE public.care_actions c
   SET agent_id = a.agent_id
  FROM public.care_agents a
 WHERE c.approved_by = a.email AND c.agent_id IS NULL;

-- Add the foreign key relating each action to its owning care agent.
ALTER TABLE public.care_actions
    DROP CONSTRAINT IF EXISTS fk_care_actions_agent;
ALTER TABLE public.care_actions
    ADD CONSTRAINT fk_care_actions_agent
    FOREIGN KEY (agent_id) REFERENCES public.care_agents (agent_id);

-- ---------------------------------------------------------------------------
-- 3. Child: care_action_events (FK → care_actions) — normalized lifecycle history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.care_action_events (
    event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id   UUID NOT NULL REFERENCES public.care_actions (id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL CHECK (event_type IN ('proposed','approved','executed','declined','note')),
    actor_email TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_care_action_events_action ON public.care_action_events (action_id);

-- Seed the child table from each action's existing JSONB audit_trail (normalize history → rows).
INSERT INTO public.care_action_events (action_id, event_type, actor_email, notes, created_at)
SELECT c.id,
       COALESCE(e->>'action', c.status),
       COALESCE(e->>'by', c.approved_by),
       e->>'notes',
       c.created_at
FROM public.care_actions c
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.audit_trail) = 'array' AND jsonb_array_length(c.audit_trail) > 0
         THEN c.audit_trail ELSE '[{}]'::jsonb END) AS e
WHERE NOT EXISTS (SELECT 1 FROM public.care_action_events ev WHERE ev.action_id = c.id);
