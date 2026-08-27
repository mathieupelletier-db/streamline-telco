"""Streamline Care Desk — Milestone 3 app (Visualize -> Assist -> Act).

Answers the hero question as a DECISION, not a lookup: surface the at-risk book (ranked),
prescribe the offer (assistant explains + what-ifs + drafts the memo), approve (human-in-the-loop),
and act (write back to the writable Postgres table; the committed decision shows on the next read).

Reads the Build-1 SYNCED Unity Catalog tables (read-only) and writes ONLY the writable operational
tables (care_actions, care_action_events, workflow_state).
"""
import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from server.db import pool, query, execute, jdumps
from server import search, llm

APP_USER = os.environ.get("APP_USER_EMAIL", "rae.nakamura@streamline.example")


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open(wait=True, timeout=30.0)
    yield
    pool.close()


app = FastAPI(title="Streamline Care Desk", lifespan=lifespan)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 1 — VISUALIZE: the live, ranked at-risk view + a trigger that re-scores it.
# ─────────────────────────────────────────────────────────────────────────────

VIEW_SQL = """
SELECT p.subscriber_id, p.plan_type, p.tenure_months, p.home_metro, p.service_node_id,
       p.churn_risk_score, p.churn_reason, p.risk_band, p.clv_at_risk_usd,
       p.open_ticket_count, p.has_open_outage, p.has_open_billing,
       r.recommended_offer, r.predicted_retained_clv_usd, r.predicted_net_value_usd,
       latest.status AS action_status
FROM public.subscriber_position p
JOIN public.retention_recommendations r ON p.subscriber_id = r.subscriber_id
LEFT JOIN LATERAL (
    SELECT status FROM public.care_actions ca
    WHERE ca.subscriber_id = p.subscriber_id
    ORDER BY ca.created_at DESC LIMIT 1
) latest ON true
WHERE p.risk_band IN ('critical', 'elevated')
ORDER BY (latest.status IS NOT NULL), p.clv_at_risk_usd DESC
"""


@app.get("/api/view")
def live_view(limit: int = 50):
    """The ranked at-risk book — open, unactioned, highest CLV-at-risk first."""
    return query(VIEW_SQL + " LIMIT %s", (limit,))


@app.post("/api/trigger/score-view")
def trigger_score_view(source: str = "system_update"):
    """A trigger (schedule / system update) re-scores the view and records a trigger event.
    Scores higher than a person opening the view: this is the automated re-scoring signal."""
    rows = query(VIEW_SQL, ())
    open_atrisk = [r for r in rows if r["action_status"] is None]
    detail = {
        "subscribers_scored": len(rows),
        "open_unactioned": len(open_atrisk),
        "total_clv_at_risk_usd": round(sum(float(r["clv_at_risk_usd"] or 0) for r in rows), 2),
        "top_subscriber_id": open_atrisk[0]["subscriber_id"] if open_atrisk else None,
    }
    ev = execute(
        """INSERT INTO public.workflow_state (event_kind, event_type, source, subscriber_id, detail)
           VALUES ('trigger', 'view_scored', %s, %s, %s::jsonb)
           RETURNING event_id, created_at""",
        (source, detail["top_subscriber_id"], json.dumps(detail)),
    )[0]
    return {"event_id": str(ev["event_id"]), "created_at": ev["created_at"].isoformat(), **detail}


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 2 — ASSIST: explain why flagged, what-if scenario explorer, draft the memo.
# Retrieves from the Build-1 Lakebase Search BM25 index (not a separate vector store).
# ─────────────────────────────────────────────────────────────────────────────

def _subscriber(subscriber_id: str) -> dict:
    rows = query(
        """SELECT p.*, r.recommended_offer, r.predicted_retained_clv_usd,
                  r.predicted_net_value_usd, r.offer_ranking
           FROM public.subscriber_position p
           LEFT JOIN public.retention_recommendations r ON p.subscriber_id = r.subscriber_id
           WHERE p.subscriber_id = %s""",
        (subscriber_id,),
    )
    if not rows:
        raise HTTPException(404, f"subscriber {subscriber_id} not found")
    return rows[0]


def _assist_log(entry: dict):
    """Append one assistant interaction (request + model response) to workflow_state.detail."""
    execute(
        """INSERT INTO public.workflow_state (event_kind, event_type, source, subscriber_id, detail)
           VALUES ('trigger', %s, 'app_user', %s, %s::jsonb)""",
        (entry["type"], entry.get("subscriber_id"), jdumps(entry)),
    )


class ExplainReq(BaseModel):
    subscriber_id: str


@app.post("/api/assist/explain")
def assist_explain(req: ExplainReq):
    """Explain WHY the subscriber is flagged — grounded on their service history (BM25 retrieval)."""
    sub = _subscriber(req.subscriber_id)
    hits = search.search_service_history(
        f"{sub.get('churn_reason','')} outage billing dispute open ticket node {sub.get('service_node_id','')}"
    )
    grounding = "\n".join(f"- {h['subscriber_id']}: {h['service_summary']}" for h in hits[:3])
    prompt = [
        {"role": "system", "content": "You are a telecom care-retention analyst. Explain concisely "
         "(3-4 sentences) why this subscriber is at churn risk, citing the concrete evidence."},
        {"role": "user", "content":
            f"Subscriber {sub['subscriber_id']}: plan={sub['plan_type']}, tenure={sub['tenure_months']}mo, "
            f"risk={sub['churn_risk_score']}, band={sub['risk_band']}, reason={sub['churn_reason']}, "
            f"open_tickets={sub['open_ticket_count']}, outage={sub['has_open_outage']}, "
            f"billing_dispute={sub['has_open_billing']}, CLV_at_risk=${sub['clv_at_risk_usd']}.\n\n"
            f"Retrieved service history (Lakebase Search):\n{grounding}\n\nWhy are they at risk?"},
    ]
    answer = llm.chat(prompt)
    entry = {"type": "assist_explain", "subscriber_id": req.subscriber_id,
             "request": {"subscriber_id": req.subscriber_id, "retrieval_query": prompt[1]["content"][:200]},
             "retrieved": hits[:3], "response": answer, "model": llm.MODEL,
             "ts": datetime.now(timezone.utc).isoformat()}
    _assist_log(entry)
    return entry


class WhatIfReq(BaseModel):
    subscriber_id: str
    scenario: str  # natural-language what-if, e.g. "what if we offer a plan discount instead?"


@app.post("/api/assist/whatif")
def assist_whatif(req: WhatIfReq):
    """Scenario explorer — arithmetic what-if over the model's ranked offers."""
    sub = _subscriber(req.subscriber_id)
    ranking = sub.get("offer_ranking")
    ranking = json.loads(ranking) if isinstance(ranking, str) else (ranking or [])
    prompt = [
        {"role": "system", "content": "You are a retention analyst. Answer the what-if using ONLY "
         "the provided ranked offers. Quote predicted retained CLV and net value. Be concise."},
        {"role": "user", "content":
            f"Subscriber {sub['subscriber_id']} (reason={sub['churn_reason']}). "
            f"Model-ranked offers: {json.dumps(ranking)}. "
            f"Recommended: {sub.get('recommended_offer')} "
            f"(retained ${sub.get('predicted_retained_clv_usd')}, net ${sub.get('predicted_net_value_usd')}).\n\n"
            f"What-if: {req.scenario}"},
    ]
    answer = llm.chat(prompt)
    entry = {"type": "assist_whatif", "subscriber_id": req.subscriber_id,
             "request": {"subscriber_id": req.subscriber_id, "scenario": req.scenario},
             "offer_ranking": ranking, "response": answer, "model": llm.MODEL,
             "ts": datetime.now(timezone.utc).isoformat()}
    _assist_log(entry)
    return entry


class DraftReq(BaseModel):
    subscriber_id: str


@app.post("/api/assist/draft")
def assist_draft(req: DraftReq):
    """Auto-draft the call-resolution memo for the recommended offer."""
    sub = _subscriber(req.subscriber_id)
    offer_hits = search.search_offers(f"{sub.get('churn_reason','')} outage billing credit")
    prompt = [
        {"role": "system", "content": "Draft a short, professional call-resolution memo (Markdown) "
         "a care lead can approve: situation, why, the recommended offer, expected retained CLV, next step."},
        {"role": "user", "content":
            f"Subscriber {sub['subscriber_id']}, {sub['plan_type']}, {sub['tenure_months']}mo, "
            f"{sub['home_metro']}, reason={sub['churn_reason']}, risk={sub['churn_risk_score']}. "
            f"Recommended offer: {sub.get('recommended_offer')}, predicted retained CLV "
            f"${sub.get('predicted_retained_clv_usd')}. Matching catalog offer: "
            f"{offer_hits[0]['offer_name'] if offer_hits else 'n/a'}."},
    ]
    memo = llm.chat(prompt, max_tokens=700)
    entry = {"type": "assist_draft", "subscriber_id": req.subscriber_id,
             "request": {"subscriber_id": req.subscriber_id},
             "response": memo, "model": llm.MODEL, "ts": datetime.now(timezone.utc).isoformat()}
    _assist_log(entry)
    return entry


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 3 — ACT: propose -> human approves -> commit; committed decision shows next read.
# Writes ONLY writable tables (care_actions, care_action_events, workflow_state).
# ─────────────────────────────────────────────────────────────────────────────

class ProposeReq(BaseModel):
    subscriber_id: str
    offer_type: str
    offer_id: str | None = None
    drafted_summary: str
    predicted_retained_clv_usd: float | None = None


@app.post("/api/act/propose")
def act_propose(req: ProposeReq):
    """Create a PROPOSED care action (status='proposed') — not yet committed. Records a decision event."""
    agent = query("SELECT agent_id FROM public.care_agents LIMIT 1")
    agent_id = agent[0]["agent_id"] if agent else None
    row = execute(
        """INSERT INTO public.care_actions
             (subscriber_id, agent_id, offer_type, offer_id, drafted_summary,
              predicted_retained_clv_usd, status, approved_by, decided_week, audit_trail)
           VALUES (%s,%s,%s,%s,%s,%s,'proposed',NULL, to_char(now(),'IYYY-"W"IW'),
                   %s::jsonb)
           RETURNING id, subscriber_id, offer_type, status, created_at""",
        (req.subscriber_id, agent_id, req.offer_type, req.offer_id, req.drafted_summary,
         req.predicted_retained_clv_usd,
         json.dumps([{"at": datetime.now(timezone.utc).isoformat(), "by": APP_USER, "action": "proposed"}])),
    )[0]
    execute(
        """INSERT INTO public.workflow_state (event_kind, event_type, source, subscriber_id, action_id, detail)
           VALUES ('decision','action_proposed','app_user',%s,%s,%s::jsonb)""",
        (req.subscriber_id, row["id"], json.dumps({"offer_type": req.offer_type, "by": APP_USER})),
    )
    return {"action_id": str(row["id"]), "subscriber_id": row["subscriber_id"],
            "offer_type": row["offer_type"], "status": row["status"],
            "created_at": row["created_at"].isoformat()}


class ApproveReq(BaseModel):
    action_id: str
    approver: str
    decision: str = "approved"  # 'approved' | 'overridden'
    override_offer_type: str | None = None


@app.post("/api/act/approve")
def act_approve(req: ApproveReq):
    """Human approves (or corrects) the proposed action -> COMMIT (status='executed'). Closed loop."""
    cur = query("SELECT id, subscriber_id, offer_type, status FROM public.care_actions WHERE id=%s",
                (req.action_id,))
    if not cur:
        raise HTTPException(404, "action not found")
    offer_type = req.override_offer_type or cur[0]["offer_type"]
    row = execute(
        """UPDATE public.care_actions
           SET status='executed', offer_type=%s, approved_by=%s, decided_at=now(),
               audit_trail = audit_trail || %s::jsonb
           WHERE id=%s
           RETURNING id, subscriber_id, offer_type, status, approved_by, created_at, decided_at""",
        (offer_type, req.approver,
         json.dumps([{"at": datetime.now(timezone.utc).isoformat(), "by": req.approver,
                      "action": req.decision, "tool": "act_approve"}]),
         req.action_id),
    )[0]
    execute(
        """INSERT INTO public.workflow_state (event_kind, event_type, source, subscriber_id, action_id, detail)
           VALUES ('decision','action_committed','app_user',%s,%s,%s::jsonb)""",
        (row["subscriber_id"], row["id"],
         json.dumps({"approver": req.approver, "decision": req.decision, "offer_type": offer_type})),
    )
    return {"action_id": str(row["id"]), "subscriber_id": row["subscriber_id"],
            "offer_type": row["offer_type"], "status": row["status"], "approved_by": row["approved_by"],
            "created_at": row["created_at"].isoformat(),
            "committed_at": row["decided_at"].isoformat() if row["decided_at"] else None}


@app.get("/api/health")
def health():
    return {"ok": True}


# Minimal single-page UI (Visualize -> Assist -> Act) served at /
from fastapi.responses import HTMLResponse  # noqa: E402


@app.get("/", response_class=HTMLResponse)
def index():
    return HTMLResponse(_INDEX_HTML)


_INDEX_HTML = """<!doctype html><html><head><meta charset=utf-8>
<title>Streamline Care Desk</title><style>
body{font:14px system-ui;margin:0;background:#0f1419;color:#e8ecf0}
header{padding:16px 24px;background:#161b22;border-bottom:1px solid #222}
h1{font-size:18px;margin:0}main{padding:24px;max-width:1100px;margin:auto}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:6px 10px;border-bottom:1px solid #222;text-align:left}
.crit{color:#e5484d;font-weight:600}.btn{background:#4f7ce3;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer}
.card{background:#161b22;border:1px solid #222;border-radius:8px;padding:16px;margin:12px 0}pre{white-space:pre-wrap}
</style></head><body>
<header><h1>Streamline Care Desk — surface · prescribe · approve · act</h1></header>
<main>
<div class=card><button class=btn onclick=score()>Run trigger (re-score view)</button> <span id=trig></span></div>
<div class=card><h3>At-risk book (ranked)</h3><table id=tbl><thead><tr><th>Subscriber</th><th>Plan</th><th>Reason</th><th>Risk</th><th>CLV at risk</th><th>Offer</th><th>Status</th></tr></thead><tbody></tbody></table></div>
<div id=detail></div>
<script>
async function load(){let r=await fetch('/api/view');let d=await r.json();
document.querySelector('#tbl tbody').innerHTML=d.map(x=>`<tr><td><a href=# onclick="sel('${x.subscriber_id}')">${x.subscriber_id}</a></td><td>${x.plan_type}</td><td>${x.churn_reason}</td><td class=crit>${x.churn_risk_score}</td><td>$${Math.round(x.clv_at_risk_usd)}</td><td>${x.recommended_offer||''}</td><td>${x.action_status||'open'}</td></tr>`).join('')}
async function score(){let r=await fetch('/api/trigger/score-view',{method:'POST'});let d=await r.json();document.getElementById('trig').textContent=`scored ${d.subscribers_scored}, open ${d.open_unactioned}, CLV $${d.total_clv_at_risk_usd}`;load()}
async function sel(id){let e=await(await fetch('/api/assist/explain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscriber_id:id})})).json();
document.getElementById('detail').innerHTML=`<div class=card><h3>${id}</h3><b>Why:</b><pre>${e.response}</pre></div>`}
load()
</script></main></body></html>"""
