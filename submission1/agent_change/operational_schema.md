# Operational schema — Streamline Telco Care Desk (Lakebase Postgres)

The write surface is modeled for the domain as a set of **related tables with primary and
foreign keys**, not a single flat table. It sits alongside the read-only synced mirrors that
replicate the governed Delta gold layer.

## Entity-relationship model

```
                 care_agents
                 ┌────────────────────────────┐
                 │ agent_id      PK            │
                 │ email         UNIQUE NOT NULL│
                 │ display_name  NOT NULL      │
                 │ team                        │
                 └──────────────┬──────────────┘
                                │ 1
                                │
                                │ N   (fk_care_actions_agent)
                 ┌──────────────┴──────────────┐
                 │ care_actions                │  ← the ONLY table the app writes
                 │ id            PK (uuid)      │
                 │ agent_id      FK → care_agents.agent_id │
                 │ subscriber_id  → subscriber_position (synced mirror) │
                 │ offer_id       → offers (synced mirror)             │
                 │ offer_type, drafted_summary, status,                │
                 │ predicted_retained_clv_usd, approved_by,            │
                 │ decided_week, audit_trail(jsonb), created_at, decided_at │
                 └──────────────┬──────────────┘
                                │ 1
                                │
                                │ N   (care_action_events_action_id_fkey, ON DELETE CASCADE)
                 ┌──────────────┴──────────────┐
                 │ care_action_events          │  ← normalized lifecycle history
                 │ event_id      PK (uuid)     │
                 │ action_id     FK → care_actions.id │
                 │ event_type    CHECK(proposed/approved/executed/declined/note) │
                 │ actor_email, notes, created_at │
                 └────────────────────────────┘
```

## Relationships (live, verified on the production branch)

| Table | Key | Type | References |
|---|---|---|---|
| `care_agents` | `agent_id` | PK | — |
| `care_agents` | `email` | UNIQUE | — |
| `care_actions` | `id` | PK | — |
| `care_actions` | `agent_id` | **FK** | `care_agents.agent_id` |
| `care_action_events` | `event_id` | PK | — |
| `care_action_events` | `action_id` | **FK (cascade)** | `care_actions.id` |

Plus two natural-key relationships into the read-only synced mirrors (Delta gold layer):
`care_actions.subscriber_id → subscriber_position.subscriber_id` and
`care_actions.offer_id → offers.offer_id`.

## Build constructs (in the repo)

- **DDL / migration:** `migrations/002_operational_schema.sql` (this folder's
  `agent_change/` mirrors the migration + evidence).
- **ORM model:** `app/server/db/schema.ts` — Drizzle definitions for `careAgents`,
  `careActions` (with `.references(() => careAgents.agentId)`), and `careActionEvents`
  (with `.references(() => careActions.id, { onDelete: 'cascade' })`).

## Execution evidence

- `operational_schema_result.json` — the live PK/FK inventory + a 3-table domain join
  (`care_agents ⋈ care_actions ⋈ care_action_events`) returning real rows, captured from
  the Lakebase **production** branch after promotion.
