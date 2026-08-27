#!/usr/bin/env bash
# Proof-of-execution for the writable operational tables, distinct from the read-only synced mirrors.
# Inserts + updates care_actions (and its child care_action_events), reads them back, and prints
# the ownership distinction. Idempotent. Usage: PROFILE=DEFAULT ./lakebase_write_demo.sh
set -euo pipefail
PROFILE="${PROFILE:-DEFAULT}"; PROJECT="streamline-telco"; BR="projects/${PROJECT}/branches/production"
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
HOST=$(databricks postgres list-endpoints "$BR" -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['status']['hosts']['host'])")
TOKEN=$(databricks postgres generate-database-credential "$BR/endpoints/primary" -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
EMAIL=$(databricks current-user me -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['userName'])")
URI="host=$HOST port=5432 dbname=databricks_postgres user=$EMAIL sslmode=require"

echo "### Ownership distinction (writable app tables vs read-only synced mirrors)"
PGPASSWORD=$TOKEN psql "$URI" -c "
SELECT c.relname AS relation, pg_get_userbyid(c.relowner) AS owner,
       CASE WHEN pg_get_userbyid(c.relowner)='databricks_writer_16405' THEN 'READ-ONLY synced' ELSE 'WRITABLE app-owned' END AS role
FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE n.nspname='public' AND c.relname IN ('subscriber_position','open_atrisk','retention_recommendations','offers','care_actions','care_action_events','care_agents')
ORDER BY role, relation;"

echo "### INSERT into care_actions (writable) + child event, then read back"
PGPASSWORD=$TOKEN psql "$URI" -c "
INSERT INTO public.care_actions (subscriber_id, agent_id, offer_type, offer_id, drafted_summary, predicted_retained_clv_usd, status, approved_by, decided_week, audit_trail)
SELECT 'SUB-0007220', (SELECT agent_id FROM public.care_agents LIMIT 1), 'bill_credit','OFFER-001','Bill credit for outage + billing dispute.',1301.55,'approved','$EMAIL', to_char(now(),'IYYY-\"W\"IW'),
       '[{\"action\":\"approved\",\"by\":\"$EMAIL\",\"tool\":\"execute_retention_action\"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.care_actions WHERE subscriber_id='SUB-0007220')
RETURNING id, subscriber_id, offer_type, status;"
PGPASSWORD=$TOKEN psql "$URI" -c "
UPDATE public.care_actions SET status='executed', decided_at=now() WHERE subscriber_id='SUB-0007220' RETURNING id, status, decided_at;"

echo "### Read back (agent -> action -> events join)"
PGPASSWORD=$TOKEN psql "$URI" -c "
SELECT ca.subscriber_id, ag.display_name AS agent, ca.offer_type, ca.status, count(ev.event_id) AS events
FROM public.care_actions ca JOIN public.care_agents ag ON ca.agent_id=ag.agent_id
LEFT JOIN public.care_action_events ev ON ev.action_id=ca.id
GROUP BY 1,2,3,4 ORDER BY 1;"
