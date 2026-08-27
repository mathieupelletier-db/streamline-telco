"""Lakebase Postgres connection pool (OAuth token per connection)."""
import os
import json
from decimal import Decimal
from datetime import datetime, date
from uuid import UUID
import psycopg
from psycopg_pool import ConnectionPool
from . import auth


def to_jsonable(obj):
    """Recursively convert psycopg return types (Decimal/datetime/UUID) to JSON-safe values."""
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, UUID):
        return str(obj)
    return obj


def jdumps(obj) -> str:
    return json.dumps(to_jsonable(obj))

ENDPOINT_NAME = os.environ.get(
    "ENDPOINT_NAME", "projects/streamline-telco/branches/production/endpoints/primary"
)


class OAuthConnection(psycopg.Connection):
    """Generates a fresh Lakebase OAuth token whenever the pool opens a connection."""

    @classmethod
    def connect(cls, conninfo="", **kwargs):
        kwargs["password"] = auth.lakebase_credential(ENDPOINT_NAME)
        return super().connect(conninfo, **kwargs)


HOST = os.environ["PGHOST"]
USER = os.environ["PGUSER"]
PORT = os.environ.get("PGPORT", "5432")
DB = os.environ.get("PGDATABASE", "databricks_postgres")

pool = ConnectionPool(
    conninfo=f"dbname={DB} user={USER} host={HOST} port={PORT} sslmode=require",
    connection_class=OAuthConnection,
    min_size=1,
    max_size=10,
    max_lifetime=2700,
    open=False,
)


def query(sql: str, params: tuple = ()) -> list[dict]:
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [to_jsonable(dict(zip(cols, row))) for row in cur.fetchall()]


def execute(sql: str, params: tuple = ()) -> list[dict]:
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        out = []
        if cur.description:
            cols = [d[0] for d in cur.description]
            out = [dict(zip(cols, row)) for row in cur.fetchall()]
        conn.commit()
        return out
