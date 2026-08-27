# Databricks notebook source
# MAGIC %md
# MAGIC # Care Desk — scheduled trigger (re-score the at-risk view)
# MAGIC
# MAGIC Layer-1 trigger for the Care Desk. Runs on a **schedule** (a system event, not a person
# MAGIC opening the app) to re-score the at-risk book and write a `view_scored` trigger event into
# MAGIC the Lakebase `workflow_state` observability table. This is the automated signal that keeps
# MAGIC the live view fresh — it fires whether or not anyone is looking.
# MAGIC
# MAGIC Reads the read-only synced UC tables; writes only `workflow_state`.

# COMMAND ----------

import json
from databricks.sdk import WorkspaceClient
import psycopg2

CATALOG_BRANCH = "projects/streamline-telco/branches/production/endpoints/primary"
w = WorkspaceClient()
host = "ep-fancy-frost-e8290smv.database.centralus.azuredatabricks.net"
user = w.current_user.me().user_name
token = w.postgres.generate_database_credential(endpoint=CATALOG_BRANCH).token

conn = psycopg2.connect(host=host, port=5432, dbname="databricks_postgres",
                        user=user, password=token, sslmode="require")
cur = conn.cursor()

# Re-score: count the open, unactioned at-risk book + total CLV at risk.
cur.execute("""
  SELECT p.subscriber_id, p.clv_at_risk_usd,
         (SELECT status FROM public.care_actions ca WHERE ca.subscriber_id=p.subscriber_id
          ORDER BY ca.created_at DESC LIMIT 1) AS action_status
  FROM public.subscriber_position p
  JOIN public.retention_recommendations r ON p.subscriber_id=r.subscriber_id
  WHERE p.risk_band IN ('critical','elevated')
  ORDER BY p.clv_at_risk_usd DESC
""")
rows = cur.fetchall()
open_rows = [r for r in rows if r[2] is None]
detail = {
    "subscribers_scored": len(rows),
    "open_unactioned": len(open_rows),
    "total_clv_at_risk_usd": round(sum(float(r[1] or 0) for r in rows), 2),
    "top_subscriber_id": open_rows[0][0] if open_rows else None,
    "trigger": "scheduled",
}
cur.execute(
    """INSERT INTO public.workflow_state (event_kind, event_type, source, subscriber_id, detail)
       VALUES ('trigger','view_scored','schedule',%s,%s::jsonb)
       RETURNING event_id, created_at""",
    (detail["top_subscriber_id"], json.dumps(detail)),
)
ev = cur.fetchone()
conn.commit()
cur.close(); conn.close()

result = {"event_id": str(ev[0]), "created_at": ev[1].isoformat(), **detail}
print(json.dumps(result, indent=2))
dbutils.notebook.exit(json.dumps(result))
