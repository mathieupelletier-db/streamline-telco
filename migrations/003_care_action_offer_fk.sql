-- Migration: 003_care_action_offer_fk
-- Author: Isaac (Claude Code coding agent)
-- Co-authored-by: Isaac <no-reply@databricks.com>
--
-- Completes the operational-schema relationships: relate care_actions to the offer catalog with a
-- proper foreign key. The offer catalog is a read-only synced mirror, so we keep an app-owned
-- reference copy (care_offer_catalog) that the FK targets — you can't add a constraint that
-- references a sync-pipeline-owned table. This makes the "which offer was applied" relationship a
-- first-class, referentially-enforced link instead of a bare text column.
--
-- ER model after this change:
--   care_agents (1) ──< (N) care_actions (N) >── (1) care_offer_catalog
--                              │ 1
--                              └──< (N) care_action_events

-- 1. App-owned reference copy of the offer catalog (seeded from the synced mirror).
CREATE TABLE IF NOT EXISTS public.care_offer_catalog (
    offer_id    TEXT PRIMARY KEY,
    offer_name  TEXT NOT NULL,
    offer_type  TEXT NOT NULL,
    value_usd   DOUBLE PRECISION,
    description TEXT
);

-- Seed from the synced offers mirror when it's present (production); otherwise seed the
-- canonical catalog rows directly so the FK target is populated on any branch.
DO $$
BEGIN
  IF to_regclass('public.offers') IS NOT NULL THEN
    INSERT INTO public.care_offer_catalog (offer_id, offer_name, offer_type, value_usd, description)
    SELECT offer_id, offer_name, offer_type, value_usd, description FROM public.offers
    ON CONFLICT (offer_id) DO UPDATE
      SET offer_name = EXCLUDED.offer_name, offer_type = EXCLUDED.offer_type,
          value_usd = EXCLUDED.value_usd, description = EXCLUDED.description;
  ELSE
    INSERT INTO public.care_offer_catalog (offer_id, offer_name, offer_type, value_usd, description) VALUES
      ('OFFER-001','One-Time Bill Credit $50','bill_credit',50,'A one-time account credit that acknowledges a service or billing issue.'),
      ('OFFER-002','One-Time Bill Credit $100','bill_credit',100,'A larger one-time credit for high-value subscribers with a service or billing grievance.'),
      ('OFFER-003','20% Plan Discount 12mo','plan_upgrade_discount',0.2,'A recurring 20% discount for 12 months for price-driven churn.'),
      ('OFFER-004','Unlimited Upgrade Discount','plan_upgrade_discount',0.15,'A discounted unlimited-plan upgrade for price-sensitive mobile subscribers.'),
      ('OFFER-005','Subsidized Device Upgrade','device_upgrade',300,'A subsidized new device for high-ARPU subscribers whose churn reason is device or experience.')
    ON CONFLICT (offer_id) DO NOTHING;
  END IF;
END $$;

-- 2. Relate care_actions.offer_id to the catalog with a foreign key.
--    NOT VALID first (existing rows may predate the catalog), then VALIDATE so new writes are checked.
ALTER TABLE public.care_actions
    DROP CONSTRAINT IF EXISTS fk_care_actions_offer;
ALTER TABLE public.care_actions
    ADD CONSTRAINT fk_care_actions_offer
    FOREIGN KEY (offer_id) REFERENCES public.care_offer_catalog (offer_id) NOT VALID;
ALTER TABLE public.care_actions VALIDATE CONSTRAINT fk_care_actions_offer;
