#!/usr/bin/env bash
# Milestone 2 — Lakebase provisioning for Streamline Telco (Autoscaling tier).
#
# Reproducible record of the managed setup: an Autoscaling Postgres project + production/dev
# branches, a UC database catalog over it, four managed Synced Tables (read-only mirrors of the
# gold/raw tables), and the writable care_actions table the app's Act layer writes to.
#
# Prereqs: databricks CLI >= 0.285.0 (postgres beta commands), psql (libpq), an authenticated
# profile with Lakebase enabled. Usage: PROFILE=DEFAULT ./lakebase_setup_streamline.sh
set -euo pipefail

PROFILE="${PROFILE:-DEFAULT}"
PROJECT="streamline-telco"
SRC_CATALOG="ai_demo_gen"
SRC_SCHEMA="streamline_telco"
UC_CATALOG="streamline_lakebase"        # UC catalog registered over the Lakebase DB
PG_DB="databricks_postgres"             # the logical Postgres database
BRANCH="projects/${PROJECT}/branches/production"

echo "==> 1. Create Autoscaling project (auto-creates production branch + primary endpoint)"
databricks postgres create-project "$PROJECT" \
  --json '{"spec": {"display_name": "Streamline Telco — Care Desk"}}' --no-wait -p "$PROFILE" || true

echo "==> 2. Create dev branch (iterate safely off production)"
databricks postgres create-branch "projects/${PROJECT}" dev \
  --json "{\"spec\": {\"source_branch\": \"${BRANCH}\", \"no_expiry\": true}}" -p "$PROFILE" || true

echo "==> 3. Register the Lakebase DB as a UC catalog (note: CLI drops the outer 'catalog' wrapper)"
databricks postgres create-catalog "$UC_CATALOG" \
  --json "{\"spec\": {\"postgres_database\": \"${PG_DB}\", \"branch\": \"${BRANCH}\"}}" -p "$PROFILE" || true

echo "==> 4. Create the four managed Synced Tables (read-only mirrors, SNAPSHOT scheduling)"
create_synced() {  # $1 = target table id, $2 = source Delta table, $3 = primary key
  databricks postgres create-synced-table "${UC_CATALOG}.public.$1" \
    --json "{\"spec\": {\"postgres_database\": \"${PG_DB}\", \"branch\": \"${BRANCH}\", \
      \"scheduling_policy\": \"SNAPSHOT\", \"source_table_full_name\": \"$2\", \
      \"primary_key_columns\": [\"$3\"], \"create_database_objects_if_missing\": true, \
      \"new_pipeline_spec\": {\"storage_catalog\": \"${SRC_CATALOG}\", \"storage_schema\": \"${SRC_SCHEMA}\"}}}" \
    --no-wait -p "$PROFILE"
}
create_synced subscriber_position        "${SRC_CATALOG}.${SRC_SCHEMA}.gold_subscriber_position"        subscriber_id
create_synced open_atrisk                "${SRC_CATALOG}.${SRC_SCHEMA}.gold_open_atrisk"                 subscriber_id
create_synced retention_recommendations  "${SRC_CATALOG}.${SRC_SCHEMA}.gold_retention_recommendations"  subscriber_id
create_synced offers                     "${SRC_CATALOG}.${SRC_SCHEMA}.raw_offers"                       offer_id

echo "==> 5. Create the writable care_actions table (the ONLY table the app writes to)"
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
HOST=$(databricks postgres list-endpoints "$BRANCH" -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['status']['hosts']['host'])")
TOKEN=$(databricks postgres generate-database-credential "${BRANCH}/endpoints/primary" -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
EMAIL=$(databricks current-user me -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['userName'])")
PGPASSWORD="$TOKEN" psql "host=$HOST port=5432 dbname=$PG_DB user=$EMAIL sslmode=require" -c "
CREATE TABLE IF NOT EXISTS public.care_actions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id               TEXT NOT NULL,
    offer_type                  TEXT NOT NULL,
    offer_id                    TEXT,
    drafted_summary             TEXT,
    predicted_retained_clv_usd  DOUBLE PRECISION,
    status                      TEXT NOT NULL DEFAULT 'proposed',
    approved_by                 TEXT,
    audit_trail                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at                  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_care_actions_subscriber ON public.care_actions (subscriber_id);
"

echo "==> Done. Synced mirrors + writable care_actions are live on ${PROJECT}/production."
