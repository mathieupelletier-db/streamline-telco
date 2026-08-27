#!/usr/bin/env bash
# Lakebase branching workflow — create a dev branch off the main line, apply a change, validate it
# on the branch, then promote it to the main branch. This is the app's captured branch → validate →
# promote cycle (the copy-on-write equivalent of a git feature-branch → PR → merge into main).
#
# Terminology: Lakebase Autoscaling's default branch is `production` — it is the MAIN line for this
# project (the protected, serving branch the app + synced tables point at). `dev` is the throwaway
# development branch created off it.
#
# Usage:
#   PROFILE=DEFAULT ./lakebase_branch_workflow.sh create      # 1. branch off main (production)
#   PROFILE=DEFAULT MIGRATION=migrations/003_x.sql ./lakebase_branch_workflow.sh apply    # 2. apply on dev
#   PROFILE=DEFAULT MIGRATION=migrations/003_x.sql ./lakebase_branch_workflow.sh promote  # 3. apply on main
set -euo pipefail

PROFILE="${PROFILE:-DEFAULT}"
PROJECT="${PROJECT:-streamline-telco}"
MAIN_BRANCH="production"                 # the main/serving line
DEV_BRANCH="dev"                         # development branch off main
PG_DB="${PG_DB:-databricks_postgres}"
CMD="${1:-help}"

pg_uri() {  # $1 = branch name → prints a psql conninfo string for that branch's primary endpoint
  local br="$1"
  local host token email
  host=$(databricks postgres list-endpoints "projects/${PROJECT}/branches/${br}" -p "$PROFILE" -o json \
        | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['status']['hosts']['host'])")
  token=$(databricks postgres generate-database-credential \
        "projects/${PROJECT}/branches/${br}/endpoints/primary" -p "$PROFILE" -o json \
        | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
  email=$(databricks current-user me -p "$PROFILE" -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['userName'])")
  echo "PGPASSWORD=${token}|host=${host} port=5432 dbname=${PG_DB} user=${email} sslmode=require"
}

case "$CMD" in
  create)
    # 1. Create the development branch as a copy-on-write snapshot OFF THE MAIN (production) branch.
    echo "==> Creating dev branch '${DEV_BRANCH}' off main branch '${MAIN_BRANCH}'"
    databricks postgres create-branch "projects/${PROJECT}" "${DEV_BRANCH}" \
      --json "{\"spec\": {\"source_branch\": \"projects/${PROJECT}/branches/${MAIN_BRANCH}\", \"no_expiry\": true}}" \
      -p "$PROFILE"
    ;;

  apply)
    # 2. Apply the migration on the DEV branch and validate there (never touch main yet).
    : "${MIGRATION:?set MIGRATION=path/to/migration.sql}"
    IFS='|' read -r PGPW CONN < <(pg_uri "$DEV_BRANCH")
    echo "==> Applying ${MIGRATION} on dev branch + validating"
    eval "$PGPW" psql "$CONN" -v ON_ERROR_STOP=1 -f "$MIGRATION"
    ;;

  promote)
    # 3. PROMOTE: apply the validated migration to the MAIN (production) branch.
    #    In git this pairs with a committed merge / PR of the same migration into `main`.
    : "${MIGRATION:?set MIGRATION=path/to/migration.sql}"
    IFS='|' read -r PGPW CONN < <(pg_uri "$MAIN_BRANCH")
    echo "==> Promoting ${MIGRATION} to main branch '${MAIN_BRANCH}'"
    eval "$PGPW" psql "$CONN" -v ON_ERROR_STOP=1 -f "$MIGRATION"
    echo "==> Promoted. Now open a PR/merge of ${MIGRATION} into git main to complete the paper trail."
    ;;

  *)
    echo "Usage: PROFILE=<p> [MIGRATION=<f>] $0 {create|apply|promote}"; exit 1;;
esac
