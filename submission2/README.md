# Build 2 Submission — Streamline Care Desk (Milestone 3)

Evidence for the Build 2 validator. A Databricks App (Visualize → Assist → Act) built
layer-by-layer on the Build-1 **development branch** (`feature/build2-app` off `main`), reading the
Build-1 **synced Unity Catalog tables** (read-only) and persisting all state + actions to
**writable Postgres tables** (`care_actions`, `care_action_events`, `workflow_state`).

Answers the hero question as a **decision** — surface, prescribe, approve, act — not a lookup.

## The three layers

- **Visualize** — `/api/view` ranks the at-risk book (open/unactioned first, by CLV at risk),
  reading the synced UC tables. A **scheduled trigger** (`/api/trigger/score-view`, source=`schedule`)
  re-scores the view and records a `view_scored` event — fires whether or not a person is looking.
- **Assist** — explains *why* a subscriber is flagged, runs *what-if* scenarios over the model's
  ranked offers, and auto-drafts the call-resolution memo. Retrieval is grounded on the **Build-1
  Lakebase Search BM25 index** (`lakebase_text`), not a separate vector store.
- **Act** — `/api/act/propose` → `/api/act/approve`: a human approves (or corrects) before commit;
  the committed decision writes to `care_actions` and is reflected on the next view read (closed loop).

## Evidence files

| File | What it shows |
|---|---|
| `writeback_table.json` | The writable action table `care_actions`: proposed action, approval status + approver, created + committed timestamps. |
| `state_table.json` | The workflow-state / observability table `workflow_state`: trigger events (`view_scored`, source `schedule`) + recorded decisions (`action_proposed`, `action_committed`), timestamped. |
| `view_query.sql` / `view_result.json` | The query backing the live ranked view + its returned rows (open at-risk + the 5 actioned subscribers reading back `executed`/`approved` — the closed loop). |
| `assist_log.jsonl` | Assistant interactions (request + model response): one `assist_explain`, one `assist_whatif`, one `assist_draft`. |
| `drafted_sample.md` | The auto-drafted call-resolution memo. |
| `hero_question.txt` | The hero question + the decision chain with linked record IDs across all exports. |
| `git_history.txt` | `git log --graph --oneline --decorate --all` — the layer-by-layer build on the dev branch off main. |

## Governance invariants held

- **Never writes the synced UC tables** (read-only in Postgres, owned by the sync pipeline);
  writes only `care_actions`, `care_action_events`, `workflow_state`.
- **Built on the dev branch** (`feature/build2-app`), keeping `main` clean to demo from.
- Retrieval reuses the **Build-1 Lakebase Search** index, not a new vector store.

## App (deployed + running)

`app_m3/` — FastAPI app (`app.py` + `server/`), `app.yaml`, `pyproject.toml`. **Deployed to
Databricks Apps and RUNNING** at
`https://streamline-care-desk-7405612117836809.9.azure.databricksapps.com`, reading the Build-1
**dev-branch** Lakebase (synced mirrors + the Build-1 Lakebase Search BM25 indexes) and calling the
`databricks-claude-sonnet-4-5` serving endpoint. All evidence here was produced by driving the
**deployed** app's endpoints (`/api/view`, `/api/trigger`, `/api/assist/*`, `/api/act/*`).

Auth is SDK-free (`server/auth.py`): OAuth M2M from the app's injected service-principal creds,
Lakebase credential + model calls via REST — so the Apps build resolves from public PyPI, not the
Databricks pypi-proxy.

## Governance / requirements held

- **Deployed on Databricks Apps**, reading the Build-1 synced UC tables (read-only).
- **Never writes the synced tables** — writes only `care_actions`, `care_action_events`, `workflow_state`.
- **Built on the dev branch** (git `feature/build2-app` off main; Lakebase branch `dev`), main kept clean.
- **Assist retrieves from the Build-1 Lakebase Search BM25 index** (`lakebase_bm25` over `offer_search`
  + `service_history_search`), not a separate vector store.
- **Hero question answered as a decision** (surface → prescribe → approve → act), closed loop.
