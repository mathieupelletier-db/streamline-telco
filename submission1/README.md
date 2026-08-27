# Build 1 Submission — Streamline Telco (Lakebase)

Evidence for the Build 1 validator. Lakebase Autoscaling project **`streamline-telco`**,
UC catalog **`streamline_lakebase`**, source data in **`ai_demo_gen.streamline_telco`**.

| # | Requirement | File(s) |
|---|---|---|
| 1 | Lakebase instance name + connectivity check (`SELECT version()`) | `connectivity_check.txt` |
| 2 | Query against the synced UC table + returned rows (non-empty) | `synced_table.sql`, `synced_table_result.json` |
| 3 | Reverse-synced UC Delta sample — SCD Type 2 history + appended system metadata columns | `reverse_sync_sample.json` |
| 4 | Dev branch off main + the changes made on it | `branch.txt` |
| 5 | Coding-agent's schema/data change (diff/migration, authorship, validation, promotion) | `agent_change/` |
| 5b | Operational schema modeled for the domain (related tables + PK/FK), promoted via a committed merge AND a merged GitHub PR into main | `agent_change/operational_schema.md`, `agent_change/002_operational_schema.sql`, `agent_change/003_care_action_offer_fk.sql`, `agent_change/operational_schema_result.json`, `agent_change/promotion_merge.txt`, `agent_change/pr_merge.txt` |
| 5c | Scale-to-zero configured so idle branches cost ~nothing | `scale_to_zero.json` (live evidence), build construct: `app/scripts/lakebase_scale_to_zero.sh` |
| 5d | Writable Postgres tables exist, distinct from read-only synced tables — WITH execution evidence | `write_execution_transcript.txt` (INSERT/UPDATE output), `write_execution_result.json` (rows + ownership), executed notebook `04_lakebase_operational_validation.ipynb` (embedded outputs), build construct: `app/scripts/lakebase_write_demo.sh` |
| 5e | Operational schema + writable/synced distinction PROVEN RUNNING (executed notebook with output) | `04_lakebase_operational_validation.ipynb` (run on serverless; cells 1-3 show live results) |
| 5f | Code-defined Delta→Lakebase sync (DAB, not UI) | `dab_sync_deploy.txt` (bundle validate + deploy + ONLINE state), build construct: `resources/lakebase_sync.yml` (`PostgresSyncedTable`) + `databricks.yml` |
| 6 | Lakebase Search query + relevant records for a natural-language query | `search_query.txt`, `search_result.json` |
| 7 | Representative business question + query + correct result | `core_question.txt`, `core_query.sql`, `core_query_result.json` |
| 8 | Git history (`git log --graph --oneline --decorate --all`) with branch off main + promotion merge | `git_history.txt` |

## Notes on each artifact

- **Connectivity** — PostgreSQL 17.11 on the `streamline-telco` production/primary endpoint.
- **Synced table** — `streamline_lakebase.public.subscriber_position` (managed UC Synced Table,
  read-only mirror of `gold_subscriber_position`) joined to `retention_recommendations`; the at-risk
  book with the model's ranked offer. 10 rows.
- **Reverse sync** — a Lakebase CDF config replicates the Postgres `public` schema back to UC as Delta
  (`ai_demo_gen.streamline_reverse.lb_care_actions_history`). The sample shows CDC change types
  (`insert`, `update_preimage`, `update_postimage`) with the appended system-metadata columns
  `_pg_change_type`, `_pg_lsn`, `_pg_xid`, `_timestamp`, `_sort_by` — the SCD2 history of the app's writes.
- **Dev branch** — Lakebase branch `dev` off `production` (copy-on-write). Change built + validated on
  `dev`, then promoted to `production`.
- **Agent change** — `agent_change/001_care_action_analytics.sql` (ALTER care_actions + care_action_metrics
  view), authored by the coding agent (see the `Co-authored-by:` trailer in `agent_change.diff` and
  `git_history.txt`). `validation_query_result.json` = the view on production; `promotion_validation.json`
  confirms both objects exist on the production branch after promotion.
- **Lakebase Search** — native **BM25** via the `lakebase_text` extension (`lakebase_bm25` access method,
  `tsvector_bm25_ops` opclass, `to_bm25query(...)` + the `<@>` ranking operator). BM25 indexes over the
  offer catalog (`offer_search`) and subscriber service history (`service_history_search`), built from the
  synced read-only mirrors. The NL query "one-time credit for a service outage or billing dispute" ranks
  the bill-credit offers by BM25 score, and the service-history search finds the critical at-risk
  subscribers whose outage/billing history matches, each joined to their `bill_credit` recommendation.
  (`lakebase_vector` is also enabled for embedding search.) BM25 `<@>` sorts ascending — a more-negative
  score means a stronger match.
- **Core question** — retention exposure across the at-risk book, answered from the synced mirrors:
  200 at-risk / all critical, $353,377 CLV at risk, all recommended `bill_credit`, $198,393 predicted retained.
