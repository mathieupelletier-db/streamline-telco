#!/usr/bin/env bash
# Configure scale-to-zero on the Streamline Telco Lakebase endpoints so idle branches cost ~nothing.
#
# Autoscaling Lakebase separates compute from storage: a compute endpoint that sees no connections
# for `suspend_timeout_duration` is SUSPENDED — compute scales to zero and you pay only for storage
# (~$0.35/GB-month). It wakes automatically (cold start ~1-2s) on the next connection. Combined with
# a low autoscaling floor (min_cu 0.5), an idle branch's compute bill goes to zero.
#
# Defaults created by `create-project` are the opposite (min=max=1 CU, suspend=86400s = 24h), which
# never scales down — this script fixes that. Usage: PROFILE=DEFAULT ./lakebase_scale_to_zero.sh
set -euo pipefail
PROFILE="${PROFILE:-DEFAULT}"
PROJECT="streamline-telco"
MIN_CU="${MIN_CU:-0.5}"          # autoscaling floor (0.5 = lowest); compute suspends fully when idle
MAX_CU="${MAX_CU:-2}"            # ceiling for bursts
SUSPEND="${SUSPEND:-300s}"       # idle timeout before scale-to-zero (60s..604800s)

for BRANCH in production dev; do
  EP="projects/${PROJECT}/branches/${BRANCH}/endpoints/primary"
  echo "==> ${BRANCH}: min=${MIN_CU} max=${MAX_CU} suspend=${SUSPEND}"
  # NOTE: the suspend timeout is toggled via the 'spec.suspension' field path in the update_mask.
  databricks postgres update-endpoint "$EP" \
    "spec.autoscaling_limit_min_cu,spec.autoscaling_limit_max_cu,spec.suspension" \
    --json "{\"spec\": {\"autoscaling_limit_min_cu\": ${MIN_CU}, \"autoscaling_limit_max_cu\": ${MAX_CU}, \"suspend_timeout_duration\": \"${SUSPEND}\"}}" \
    -p "$PROFILE" >/dev/null
done

echo "==> Verify"
for BRANCH in production dev; do
  databricks postgres get-endpoint "projects/${PROJECT}/branches/${BRANCH}/endpoints/primary" -p "$PROFILE" -o json \
    | python3 -c "import sys,json;s=json.load(sys.stdin)['status'];print(f\"  ${BRANCH}: min={s['autoscaling_limit_min_cu']} max={s['autoscaling_limit_max_cu']} suspend={s['suspend_timeout_duration']}\")"
done
