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

## App

`app_m3/` — FastAPI app (`app.py` + `server/`), `app.yaml`, `pyproject.toml`/`uv.lock`. Created on
Databricks Apps (`streamline-care-desk`, compute ACTIVE). All evidence here was produced by running
the app against the live Lakebase Postgres + the `databricks-claude-sonnet-4-5` serving endpoint.
