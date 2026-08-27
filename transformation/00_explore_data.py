# Databricks notebook source
# MAGIC %md
# MAGIC # Streamline Telco — Raw Data Exploration (pre-modeling)
# MAGIC
# MAGIC Profiles the 8 raw parquet datasets written by `data_generation/generate_data` **before** we
# MAGIC build the SDP pipeline (`01-lakeflow.md`). The goal is to *understand the data + confirm the
# MAGIC story shape holds* so the silver/gold transforms are designed against reality, not assumptions.
# MAGIC
# MAGIC **The story shape we're verifying** (from `01-lakeflow.md`): a `NODE-OHIO-14` outage ~3 weeks ago
# MAGIC + billing friction pushed ~200 subscribers into churn risk (0.7–0.9), all `service`-reason,
# MAGIC grounded in real evidence (open tickets, disputes, the node event). Everyone else stays calm
# MAGIC (~0.03–0.2). Hero `SUB-0000214` is a 5-year subscriber on the outage node → recommended offer
# MAGIC is a `bill_credit`. This notebook checks each of those before modeling.

# COMMAND ----------

from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "ai_demo_gen", "Catalog")
dbutils.widgets.text("schema", "streamline_telco", "Schema")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
RAW = f"/Volumes/{CATALOG}/{SCHEMA}/raw_data"
print(f"Exploring raw data in {RAW}")


def raw(dataset: str):
    return spark.read.parquet(f"{RAW}/{dataset}")


# Load all 8 raw datasets as temp views so we can use SQL freely.
DATASETS = ["subscribers", "offers", "usage", "billing", "tickets", "network_events", "risk_snapshots", "retention_offers"]
for d in DATASETS:
    raw(d).createOrReplaceTempView(f"raw_{d}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Inventory — row counts + schemas
# MAGIC Confirm every dataset landed at roughly the target volume from the spec.

# COMMAND ----------

targets = {
    "subscribers": 40_000, "offers": 30, "usage": 3_500_000, "billing": 700_000,
    "tickets": 250_000, "network_events": 120_000, "risk_snapshots": 200_000, "retention_offers": 40_000,
}
rows = [(d, raw(d).count(), targets[d]) for d in DATASETS]
inventory = spark.createDataFrame(rows, "dataset string, actual_rows long, spec_target long")
display(inventory)

# COMMAND ----------

for d in DATASETS:
    print(f"\n=== raw_{d} ===")
    raw(d).printSchema()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Subscriber master — plan mix, tenure, ARPU, geo
# MAGIC The base is ~40K. Plans should split ~35/35/30 broadband/mobile/bundle. Geo anchors 8 metros
# MAGIC (2 in Ohio — where the affected cohort concentrates).

# COMMAND ----------

display(spark.sql("""
  SELECT plan_type,
         COUNT(*) AS subscribers,
         ROUND(AVG(tenure_months), 1) AS avg_tenure_months,
         ROUND(AVG(monthly_arpu_usd), 2) AS avg_arpu
  FROM raw_subscribers GROUP BY plan_type ORDER BY subscribers DESC
"""))

# COMMAND ----------

display(spark.sql("""
  SELECT home_metro, state, COUNT(*) AS subscribers,
         SUM(CASE WHEN service_node_id = 'NODE-OHIO-14' THEN 1 ELSE 0 END) AS on_outage_node
  FROM raw_subscribers GROUP BY home_metro, state ORDER BY subscribers DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. The anomaly — affected vs everyday churn risk
# MAGIC The load-bearing split: affected subscribers ramp to 0.7–0.9; everyone else stays 0.03–0.2.
# MAGIC We derive "affected" as anyone with a current risk snapshot >= 0.6 (the elevated threshold).

# COMMAND ----------

# Latest snapshot per subscriber = the "current" position.
spark.sql("""
  CREATE OR REPLACE TEMP VIEW current_risk AS
  SELECT r.*
  FROM raw_risk_snapshots r
  JOIN (SELECT subscriber_id, MAX(snapshot_date) md FROM raw_risk_snapshots GROUP BY subscriber_id) m
    ON r.subscriber_id = m.subscriber_id AND r.snapshot_date = m.md
""")

display(spark.sql("""
  SELECT CASE WHEN churn_risk_score >= 0.6 THEN 'affected (>=0.6)' ELSE 'everyday (<0.6)' END AS cohort,
         COUNT(*) AS subscribers,
         ROUND(MIN(churn_risk_score), 3) AS min_risk,
         ROUND(AVG(churn_risk_score), 3) AS avg_risk,
         ROUND(MAX(churn_risk_score), 3) AS max_risk
  FROM current_risk GROUP BY 1 ORDER BY 1
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Risk ramp over time — the outage story
# MAGIC Daily avg risk on the affected cohort should build over the last ~2.5 weeks while the base is flat.

# COMMAND ----------

display(spark.sql("""
  WITH affected AS (SELECT DISTINCT subscriber_id FROM current_risk WHERE churn_risk_score >= 0.6)
  SELECT r.snapshot_date,
         ROUND(AVG(r.churn_risk_score), 3) AS avg_risk_affected,
         COUNT(*) AS snapshots
  FROM raw_risk_snapshots r JOIN affected a ON r.subscriber_id = a.subscriber_id
  GROUP BY r.snapshot_date ORDER BY r.snapshot_date
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Churn reason + the note pool (the `ai_classify` signal)
# MAGIC Every at-risk subscriber should be `service`-reason. The `agent_note_text` pool is small +
# MAGIC deduped-friendly (COUNT DISTINCT << COUNT) — that's what makes `ai_classify` cheap in silver.

# COMMAND ----------

display(spark.sql("""
  SELECT CASE WHEN churn_risk_score >= 0.6 THEN 'affected' ELSE 'everyday' END AS cohort,
         churn_reason, COUNT(*) AS subscribers
  FROM current_risk GROUP BY 1, 2 ORDER BY 1, subscribers DESC
"""))

# COMMAND ----------

display(spark.sql("""
  SELECT COUNT(*) AS total_note_rows,
         COUNT(DISTINCT agent_note_text) AS distinct_notes
  FROM raw_risk_snapshots WHERE agent_note_text IS NOT NULL
"""))

display(spark.sql("""
  SELECT agent_note_text, COUNT(*) AS n
  FROM raw_risk_snapshots WHERE agent_note_text IS NOT NULL
  GROUP BY agent_note_text ORDER BY n DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Evidence behind the "why" — tickets, billing disputes, the node event
# MAGIC The reason must be *true in the data*: open outage/billing tickets + a recent dispute on the
# MAGIC affected cohort, and the `NODE-OHIO-14` outage event ~3 weeks ago.

# COMMAND ----------

display(spark.sql("""
  SELECT ticket_type,
         COUNT(*) AS tickets,
         SUM(CASE WHEN closed_date IS NULL THEN 1 ELSE 0 END) AS open_tickets
  FROM raw_tickets GROUP BY ticket_type ORDER BY open_tickets DESC
"""))

# COMMAND ----------

display(spark.sql("SELECT * FROM raw_network_events WHERE node_id = 'NODE-OHIO-14' ORDER BY event_date"))

# COMMAND ----------

display(spark.sql("""
  SELECT disputed, dispute_reason, COUNT(*) AS bills
  FROM raw_billing GROUP BY disputed, dispute_reason ORDER BY bills DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Retention-offer learnability — is the offer↔reason signal there?
# MAGIC The heuristic (and optional ML model) learns from `raw_retention_offers`: `bill_credit` on
# MAGIC `service` reason should retain the most CLV per dollar; plan discount on `price`; device on
# MAGIC `device`. If the diagonal doesn't win, regenerate.

# COMMAND ----------

display(spark.sql("""
  SELECT offer_type, churn_reason,
         COUNT(*) AS offers,
         ROUND(AVG(CASE WHEN retained THEN 1.0 ELSE 0.0 END), 3) AS retain_rate,
         ROUND(AVG(retained_clv_usd), 0) AS avg_retained_clv,
         ROUND(AVG(offer_cost_usd), 0) AS avg_cost,
         ROUND(AVG(retained_clv_usd) / NULLIF(AVG(offer_cost_usd), 0), 2) AS clv_per_cost
  FROM raw_retention_offers
  GROUP BY offer_type, churn_reason ORDER BY offer_type, churn_reason
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. KPI targets — do the headline numbers land?
# MAGIC Preview the exposure the dashboard tiles will show, computed the same way gold will:
# MAGIC `clv_at_risk = arpu × 24 × risk` for subscribers at risk (>=0.6). Target ≈ $0.4M + ~350 open tickets.

# COMMAND ----------

display(spark.sql("""
  WITH pos AS (
    SELECT c.subscriber_id, s.monthly_arpu_usd, c.churn_risk_score, c.open_ticket_count,
           CASE WHEN c.churn_risk_score >= 0.75 AND c.open_ticket_count > 0 THEN 'critical'
                WHEN c.churn_risk_score >= 0.6  THEN 'elevated'
                WHEN c.churn_risk_score >= 0.4  THEN 'watch'
                ELSE 'healthy' END AS risk_band,
           CASE WHEN c.churn_risk_score >= 0.6 THEN s.monthly_arpu_usd * 24 * c.churn_risk_score ELSE 0 END AS clv_at_risk_usd
    FROM current_risk c JOIN raw_subscribers s ON c.subscriber_id = s.subscriber_id
  )
  SELECT ROUND(SUM(clv_at_risk_usd), 0)                                        AS total_clv_at_risk_usd,
         SUM(CASE WHEN risk_band IN ('critical','elevated') THEN open_ticket_count ELSE 0 END) AS open_tickets_on_atrisk,
         SUM(CASE WHEN risk_band = 'critical' THEN 1 ELSE 0 END)               AS critical_subscribers,
         SUM(CASE WHEN risk_band IN ('critical','elevated') THEN 1 ELSE 0 END) AS atrisk_subscribers
  FROM pos
"""))

# COMMAND ----------

display(spark.sql("""
  WITH pos AS (
    SELECT c.subscriber_id, c.churn_risk_score, c.open_ticket_count,
           CASE WHEN c.churn_risk_score >= 0.75 AND c.open_ticket_count > 0 THEN 'critical'
                WHEN c.churn_risk_score >= 0.6  THEN 'elevated'
                WHEN c.churn_risk_score >= 0.4  THEN 'watch'
                ELSE 'healthy' END AS risk_band
    FROM current_risk c
  )
  SELECT risk_band, COUNT(*) AS subscribers FROM pos GROUP BY risk_band
  ORDER BY CASE risk_band WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 WHEN 'watch' THEN 3 ELSE 4 END
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Hero deep-dive — SUB-0000214
# MAGIC The spotlight subscriber must check out: 5-year (60mo) tenure, on `NODE-OHIO-14`, high risk,
# MAGIC `service` reason, an open outage ticket + a billing dispute — the evidence that makes the
# MAGIC `bill_credit` recommendation *true*.

# COMMAND ----------

print("— Subscriber master —")
display(spark.sql("SELECT * FROM raw_subscribers WHERE subscriber_id = 'SUB-0000214'"))

print("— Current risk —")
display(spark.sql("SELECT * FROM current_risk WHERE subscriber_id = 'SUB-0000214'"))

print("— Tickets (open = closed_date NULL) —")
display(spark.sql("SELECT * FROM raw_tickets WHERE subscriber_id = 'SUB-0000214' ORDER BY opened_date DESC"))

print("— Billing disputes —")
display(spark.sql("SELECT * FROM raw_billing WHERE subscriber_id = 'SUB-0000214' AND disputed ORDER BY bill_month DESC"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Findings → modeling implications
# MAGIC Read the outputs above against `01-lakeflow.md` Section C. If they hold, proceed to build the
# MAGIC SDP pipeline (`transformation/*.sql`): silver (`note_churn_flags` via `ai_classify`,
# MAGIC `silver_tickets`, `silver_risk`, `silver_billing`, `silver_retention`) → gold
# MAGIC (`gold_subscriber_position` + `gold_open_atrisk` + `gold_retention_outcomes` +
# MAGIC `gold_retention_recommendations` heuristic). The current at-risk book is all `service`-reason
# MAGIC by design — do not synthesize price/device at-risk subscribers.
