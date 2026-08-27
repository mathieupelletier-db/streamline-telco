# Databricks notebook source
# MAGIC %md
# MAGIC # Streamline Telco — Churn Retention Recommender (OPTIONAL ML step)
# MAGIC
# MAGIC Trains an XGBoost regressor that *learns* `retained_clv_usd` from Streamline's own retention
# MAGIC history (`gold_retention_outcomes`), registers it to UC as `churn_recommender` @prod, then for
# MAGIC every at-risk subscriber constructs the three candidate offers, scores each, and **overwrites
# MAGIC `gold_retention_recommendations`** with the ranked result. Nothing downstream changes — the app,
# MAGIC dashboard, and Genie read the same table (heuristic or learned). See specifications/03-ml-churn.md.
# MAGIC
# MAGIC Batch only — no serving endpoint. Run as a serverless job. Never run locally.

# COMMAND ----------

dbutils.widgets.text("catalog", "ai_demo_gen", "Catalog")
dbutils.widgets.text("schema", "streamline_telco", "Schema")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
CS = f"{CATALOG}.{SCHEMA}"
MODEL_NAME = f"{CS}.churn_recommender"
EXPERIMENT_PATH = "/Workspace/Users/mathieu.pelletier@databricks.com/streamline/experiments/churn_recommender"

import json
import mlflow
import numpy as np
import optuna
import pandas as pd
from mlflow.tracking import MlflowClient
from pyspark.sql import functions as F
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(EXPERIMENT_PATH)

# Offer economics — matched to the raw retention-offer history (the training distribution).
OFFER_TYPES = ["bill_credit", "plan_upgrade_discount", "device_upgrade"]


def offer_cost(offer_type_col, arpu_col):
    """Cost of an offer — same formula as the generated history (bill_credit=50, plan=arpu*0.2*12, device=300)."""
    return (
        F.when(offer_type_col == "bill_credit", F.lit(50.0))
        .when(offer_type_col == "plan_upgrade_discount", F.round(arpu_col * 0.2 * 12, 2))
        .otherwise(F.lit(300.0))
    )


# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Training data — gold_retention_outcomes
# MAGIC Features: offer_type + churn_reason (the key interaction), monthly_arpu_usd, offer_cost_usd.
# MAGIC Label: retained_clv_usd. Small table (~40K rows) — pull to pandas.

# COMMAND ----------

train_sdf = spark.table(f"{CS}.gold_retention_outcomes").select(
    "offer_type", "churn_reason", "monthly_arpu_usd", "offer_cost_usd", "retained_clv_usd"
)
pdf = train_sdf.toPandas()
print(f"training rows: {len(pdf):,}")
print(pdf.groupby(["offer_type", "churn_reason"])["retained_clv_usd"].mean().round(0))

FEATURES = ["offer_type", "churn_reason", "monthly_arpu_usd", "offer_cost_usd"]
CAT_COLS = ["offer_type", "churn_reason"]
LABEL = "retained_clv_usd"


def encode(df: pd.DataFrame) -> pd.DataFrame:
    """One-hot the two categoricals against the full known category set (stable train↔score columns)."""
    out = df[["monthly_arpu_usd", "offer_cost_usd"]].copy()
    for ot in OFFER_TYPES:
        out[f"offer_{ot}"] = (df["offer_type"] == ot).astype(int)
    for r in ["service", "price", "device"]:
        out[f"reason_{r}"] = (df["churn_reason"] == r).astype(int)
    return out


X = encode(pdf)
y = pdf[LABEL]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Train — XGBoost regressor, Optuna ~10 trials, MLflow autolog

# COMMAND ----------

# Autolog WITHOUT registered_model_name so each trial doesn't mint a UC version.
mlflow.xgboost.autolog(log_input_examples=False, log_models=False, silent=True)


def objective(trial):
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 400),
        "max_depth": trial.suggest_int("max_depth", 3, 8),
        "learning_rate": trial.suggest_float("learning_rate", 0.02, 0.3, log=True),
        "subsample": trial.suggest_float("subsample", 0.7, 1.0),
    }
    with mlflow.start_run(nested=True):
        m = XGBRegressor(**params, random_state=42).fit(X_train, y_train)
        rmse = np.sqrt(mean_squared_error(y_test, m.predict(X_test)))
        mlflow.log_metric("rmse", rmse)
        return rmse


with mlflow.start_run(run_name="hpo") as parent:
    study = optuna.create_study(direction="minimize")
    study.optimize(objective, n_trials=10)
    print(f"best RMSE: {study.best_value:.1f}  params: {study.best_params}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Retrain best params + register to UC + promote @prod

# COMMAND ----------

with mlflow.start_run(run_name="best") as best_run:
    model = XGBRegressor(**study.best_params, random_state=42).fit(X, y)
    rmse = float(np.sqrt(mean_squared_error(y_test, model.predict(X_test))))
    mlflow.log_metric("val_rmse", rmse)
    signature = mlflow.models.infer_signature(X_train, model.predict(X_train))
    info = mlflow.xgboost.log_model(
        model, name="model", registered_model_name=MODEL_NAME,
        signature=signature, input_example=X_train.head(3),
    )

client = MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(MODEL_NAME, "prod", info.registered_model_version)
model_version = info.registered_model_version
print(f"registered {MODEL_NAME} v{model_version} @prod  (val RMSE {rmse:.1f})")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Build candidate offers for every at-risk subscriber + score
# MAGIC For each subscriber in gold_open_atrisk, construct all three offers, predict retained CLV,
# MAGIC compute net = predicted_retained - offer_cost, rank, and keep the argmax.

# COMMAND ----------

atrisk = spark.table(f"{CS}.gold_open_atrisk").select(
    "subscriber_id", "churn_reason", "monthly_arpu_usd", "clv_at_risk_usd"
)
offer_arr = F.array(*[F.lit(o) for o in OFFER_TYPES])
candidates = (
    atrisk
    .withColumn("offer_type", F.explode(offer_arr))
    .withColumn("offer_cost_usd", offer_cost(F.col("offer_type"), F.col("monthly_arpu_usd")))
)
cand_pdf = candidates.toPandas()
print(f"candidate rows to score: {len(cand_pdf):,} (subscribers x 3 offers)")

# Predict retained CLV for each candidate.
Xc = encode(cand_pdf)
cand_pdf["predicted_retained_clv_usd"] = np.clip(model.predict(Xc), 0, None).round(2)
cand_pdf["predicted_net_value_usd"] = (
    cand_pdf["predicted_retained_clv_usd"] - cand_pdf["offer_cost_usd"]
).round(2)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Rank per subscriber → the recommendations table shape

# COMMAND ----------

rows = []
for sub, grp in cand_pdf.groupby("subscriber_id"):
    grp = grp.sort_values("predicted_net_value_usd", ascending=False)
    top = grp.iloc[0]
    ranking = [
        {
            "offerType": r.offer_type,
            "costUsd": round(float(r.offer_cost_usd), 2),
            "predictedRetainedClvUsd": round(float(r.predicted_retained_clv_usd), 2),
            "predictedNetValueUsd": round(float(r.predicted_net_value_usd), 2),
        }
        for r in grp.itertuples()
    ]
    rows.append({
        "subscriber_id": sub,
        "recommended_offer": top.offer_type,
        "predicted_retained_clv_usd": round(float(top.predicted_retained_clv_usd), 2),
        "predicted_net_value_usd": round(float(top.predicted_net_value_usd), 2),
        "offer_ranking": json.dumps(ranking),
    })

rec_pdf = pd.DataFrame(rows)
rec_sdf = (
    spark.createDataFrame(rec_pdf)
    .withColumn("scored_at", F.current_timestamp())
)
print(f"scored subscribers: {rec_sdf.count():,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Overwrite gold_retention_recommendations
# MAGIC The table is currently an SDP materialized view (the heuristic). Drop whatever object exists
# MAGIC there, then write the learned Delta table in its place — the app/dashboard/Genie contract is
# MAGIC identical. (Re-running the SDP pipeline would rebuild the heuristic MV; the two paths alternate,
# MAGIC each overwriting the other — by design in 03-ml-churn.md.)

# COMMAND ----------

TARGET = f"{CS}.gold_retention_recommendations"
for ddl in (f"DROP MATERIALIZED VIEW IF EXISTS {TARGET}", f"DROP VIEW IF EXISTS {TARGET}", f"DROP TABLE IF EXISTS {TARGET}"):
    try:
        spark.sql(ddl)
    except Exception as e:  # noqa: BLE001
        print(f"  (skip) {ddl} -> {type(e).__name__}")

rec_sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(TARGET)
print(f"overwrote {TARGET}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Validate + exit

# COMMAND ----------

mix = {r["recommended_offer"]: r["n"] for r in
       spark.sql(f"SELECT recommended_offer, COUNT(*) n FROM {TARGET} GROUP BY recommended_offer").collect()}
hero = spark.sql(f"SELECT recommended_offer FROM {TARGET} WHERE subscriber_id='SUB-0000214'").collect()
hero_offer = hero[0]["recommended_offer"] if hero else None
total_retained = spark.sql(f"SELECT ROUND(SUM(predicted_retained_clv_usd)) t FROM {TARGET}").collect()[0]["t"]

print(f"hero SUB-0000214 -> {hero_offer}")
print(f"offer mix: {mix}")
print(f"total predicted retained CLV: ${total_retained:,.0f}")
assert hero_offer == "bill_credit", f"Hero must be bill_credit, got {hero_offer}"

result = {
    "model_version": str(model_version),
    "rmse": round(rmse, 1),
    "subscribers_scored": int(rec_sdf.count()),
    "credit_recommended": int(mix.get("bill_credit", 0)),
    "plan_recommended": int(mix.get("plan_upgrade_discount", 0)),
    "device_recommended": int(mix.get("device_upgrade", 0)),
}
dbutils.notebook.exit(json.dumps(result))
