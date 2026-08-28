# Judge Script — Streamline Telco: the churn save on the call

**Format:** ~5 min spoken pitch. Defensible without driving the app live.
**Speaker:** Mathieu Pelletier.
**One line:** a governed lakehouse turned into a save action an agent can take mid-call.

> Numbers in **bold** are the ones to land. Pause at each blank line.

---

## Hook (30s)

A five-year subscriber calls in. Three weeks with no service, a bill they're disputing, and thirty seconds before they walk. The agent's screen is showing last night's report.

That gap — between the save moment and the data — is where churn happens. Not for lack of an offer, but because no one can see *why* the customer is angry in time to pick the right one.

---

## The customer (45s)

**Streamline Telco** — broadband, mobile, streaming. **4M subscribers**, **$3.2B** revenue, **$68** ARPU.

A network outage on one node hit at the same time as a billing problem, pushing a cluster of their most valuable, long-tenured subscribers into churn risk overnight.

The hero is **Rae Nakamura**, SVP of Customer Care. Not technical, doesn't write SQL. She has to answer: which customers are we about to lose, why, and what do we do *today*?

On the cohort: **~$0.4M** of lifetime value at risk, **~200 subscribers** at critical risk. At the full base, each **0.1 pt** of monthly churn avoided is worth **~$3.9M/year**.

---

## The solution — Care Desk (2 min)

I built Rae a **Care Desk** on Databricks Apps. Five moves:

1. **See it.** She opens the app to a live churn-risk queue — a red cluster of high-value subscribers, CLV-at-risk and open tickets as KPIs. Reading from Lakebase at contact-center latency. No report, no analyst.

2. **Ask why.** She picks the worst account, **SUB-0000214** (5-year, $68/mo, risk **0.86**), and asks in plain English. The assistant investigates service and ticket history: this is a **service** problem, not price — open outage ticket + billing dispute, both on the outage node.

3. **Get the offer.** Because it's service, the assistant ranks three offers by predicted *retained* CLV and recommends the **bill credit** — it acknowledges the outage; a blind discount wouldn't. Shows the ranking and a what-if.

4. **Act.** Rae approves in one click. It writes to a **writable** Lakebase table, `care_actions`, with a full audit trail — who, when, what. Queue and KPIs update live. Human in the loop at the decision.

5. **Governed AI.** Every assistant call runs through **Unity AI Gateway** — capped, guardrailed, logged.

---

## How it's built (1 min)

- **Data layer.** Spark Declarative Pipeline, raw→silver→gold. `ai_classify` labels each subscriber's churn driver in SQL. A **Metric View** (`mv_subscriber_risk`) governs the risk/CLV definitions — dashboard, Genie, and app all read the same one.
- **Lakebase.** Gold tables sync to Postgres as **read-only** low-latency mirrors for the queue, plus a **writable** `care_actions` table for decisions. Dev branches + scale-to-zero.
- **App.** Databricks Apps, three layers — Visualize, Assist, Act. On-behalf-of auth. The assistant is a real agent loop with tools.
- **Unity AI Gateway.** Where governance stops being a slide.

---

## Governance — the part I can prove (1 min)

Live evidence of the gateway *enforcing*, not just configured. Three things fire on real calls:

- **Spend cap.** Hard budget of **5 cents** (deliberately tiny). After **~3,000 tokens**, the next call returned **HTTP 403, budget limit reached**. Honest note: the app was originally on the legacy serving path, which isn't metered — I repointed it through the gateway and redeployed before the cap could bite. Captured the whole fix.
- **Guardrails.** A call tried to bulk-export subscriber PII — SSNs, cards. Gateway blocked it: **HTTP 400, input guardrail, PII redacted**.
- **Logging.** Every call lands in a Unity Catalog table — **42 rows** in the bundle, each labeled routed-OK / guardrail-blocked / budget-blocked. Governs app, coding agent, and MCP.

Governed AI spend, predictable per call — it's in the logs, not aspirational.

---

## Close (30s)

Rae started with last night's report and a customer walking. She ends with the right at-risk customers surfaced live, the real reason explained, the best offer ranked by retained value, approved and written back in one click — and every bit of AI in that loop capped, guardrailed, and logged.

Governed data, a governed recommendation, a governed assistant. Fast enough for a full contact center, with spend that stays predictable per call.

That's the save moment, on the call. Thank you.

---

## Q&A

**Real or mocked?** Data is synthetic (~40k sampled subscribers), but pipeline, Lakebase sync, app, and gateway are deployed and live. The 403, 400, and 42-row table come from real calls.

**Why a credit over a discount?** Driver is service, not price. Ranked by predicted *retained* CLV — a credit that acknowledges the outage retains more value for a customer angry about reliability.

**How does it scale to 4M?** Lakebase read-only mirrors serve the queue at low latency; the gateway caps and meters per call so cost stays predictable as volume grows.

**What's not finished?** Slack MCP `tools/list` needs a one-time per-user OAuth (the gateway already handles the call). The ML churn model is the optional milestone — the heuristic works without it.

**What's next?** Wire in the ML churn model to replace the heuristic, and close the Slack MCP OAuth so care leads get the approval prompt in Slack.
