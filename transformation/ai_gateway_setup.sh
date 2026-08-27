#!/usr/bin/env bash
# Milestone 4 — Unity AI Gateway for the Streamline Care Desk.
#
# Governs the assistant's model endpoint (databricks-claude-sonnet-4-5 — what the app's AGENT_MODEL
# points at) with all four Gateway controls: a rate/spend cap, safety + PII guardrails, inference
# logging to a UC table, and usage tracking for per-entity attribution. The app already routes
# through this endpoint, so no app change is needed — every assistant call is now governed.
#
# Usage: PROFILE=DEFAULT ./ai_gateway_setup.sh
set -euo pipefail
PROFILE="${PROFILE:-DEFAULT}"
ENDPOINT="databricks-claude-sonnet-4-5"
WAREHOUSE="${WAREHOUSE:-e921c86338f3e272}"

echo "==> 1. UC schema for inference logs"
DATABRICKS_WAREHOUSE_ID="$WAREHOUSE" databricks experimental aitools tools query \
  "CREATE SCHEMA IF NOT EXISTS ai_demo_gen.ai_gateway COMMENT 'Unity AI Gateway inference logs + governance'" \
  --profile "$PROFILE"

echo "==> 2. Apply the AI Gateway config (cap + guardrails + inference logging + usage tracking)"
databricks serving-endpoints put-ai-gateway "$ENDPOINT" --profile "$PROFILE" --json '{
  "usage_tracking_config": {"enabled": true},
  "inference_table_config": {
    "catalog_name": "ai_demo_gen", "schema_name": "ai_gateway",
    "table_name_prefix": "streamline_care_desk", "enabled": true
  },
  "guardrails": {
    "input":  {"safety": true, "pii": {"behavior": "BLOCK"}},
    "output": {"safety": true, "pii": {"behavior": "BLOCK"}}
  },
  "rate_limits": [{"calls": 100000, "renewal_period": "minute", "key": "endpoint"}]
}'

echo "==> 3. Verify"
databricks serving-endpoints get "$ENDPOINT" --profile "$PROFILE" -o json \
  | python3 -c "import sys,json;print(json.dumps(json.load(sys.stdin).get('ai_gateway'),indent=2))"

# Per-call attribution: join the inference-log table (requester, tokens, latency) with
# app.care_actions (subscriber_id, approved_by) to attribute AI spend per subscriber/decision.
# Inference-log rows appear ~10-30 min after the first governed call.
