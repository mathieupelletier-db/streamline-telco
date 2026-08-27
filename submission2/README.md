# Build 2 Submission — Streamline Care Desk (Milestone 3)

Evidence for the Build 2 validator. The app is the **`@databricks/appkit` template** in `app/` —
Node.js + React + Express — with the graded Build-2/3 agent tools implemented (not a from-scratch
app). Built layer-by-layer on the Build-1 **development branch** (git `feature/build2-app` off
`main`; Lakebase branch `dev`), reading the Build-1 **synced Unity Catalog tables** (read-only) and
persisting all state + actions to **writable Postgres tables** (`app.care_actions`,
`app.care_action_events`).

Answers the hero question as a **decision** — surface, prescribe, approve, act — not a lookup.

## The three layers (implemented in the template)

- **Visualize** — the Care Desk queue reads `app.subscriber_position ⋈ app.retention_recommendations`
  (read-only synced mirrors) and LEFT JOINs each subscriber's latest `app.care_actions` row, so a
  committed decision shows on the next read. `view_query.sql` / `view_result.json`.
- **Assist** — the OpenAI-Agents loop (over Databricks Claude via `llm/v1/chat`) with the four tools
  implemented in `app/server/agent/caredesk.ts`:
  `find_atrisk_subscriber`, `rank_offers`, `search_history`, `execute_retention_action`
  (helpers in `app/server/db/queries/subscribers.ts`). `search_history` retrieves from the **Build-1
  Lakebase Search BM25 index** (`lakebase_text`), not a separate vector store.
- **Act** — `execute_retention_action` writes to the writable `app.care_actions` (+ an append-only
  `app.care_action_events` lifecycle row) only after human approval; the queue reflects it next read.

## Evidence files

| File | What it shows |
|---|---|
| `writeback_table.json` | The writable action table `app.care_actions`: proposed/approved action, approver, predicted retained CLV, created + committed timestamps. |
| `state_table.json` | The workflow-state / observability table `app.care_action_events`: lifecycle events (executed) linked to their action + subscriber, timestamped. |
| `view_query.sql` / `view_result.json` | The query backing the live Care Desk queue + returned rows — including the actioned subscribers reading back `action_status='approved'` (closed loop). |
| `assist_log.jsonl` | Agent interactions captured from the template's `/api/chat/stream`: one explain (tool calls `find_atrisk_subscriber` + `search_history` + `rank_offers`), one what-if, one draft — each with tool calls, tool outputs, and the model response. |
| `drafted_sample.md` | The agent's auto-drafted call-resolution memo. |
| `hero_question.txt` | The hero question + the decision chain with linked record IDs across the exports. |
| `git_history.txt` | `git log --graph --oneline --decorate --all` — the layer-by-layer build on the dev branch off main. |

## Requirements held

- **AppKit template on Databricks Apps**, reading the Build-1 synced UC tables (read-only).
- **Never writes the synced tables** — writes only `app.care_actions` + `app.care_action_events`.
- **Built on the dev branch** (git `feature/build2-app`; Lakebase branch `dev`), main kept clean.
- **Assist retrieves from the Build-1 Lakebase Search BM25 index** (`lakebase_text`), not a vector store.
- **Hero question answered as a decision** (surface → prescribe → approve → act), closed loop verified.

## The app

`app/` (committed to the branch, not in this zip — it's the full AppKit Node/React app). The graded
edits are `app/server/agent/caredesk.ts` (4 tools) and `app/server/db/queries/subscribers.ts`
(6 helpers). Verified end-to-end by driving the running template server against the dev-branch
Lakebase + the `databricks-claude-sonnet-4-5` serving endpoint: server + client build clean; the
agent investigates, ranks, and writes back; the queue reflects the committed decision.
