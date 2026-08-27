"""Lightweight Databricks auth — no databricks-sdk (keeps the app's dependency tree small so the
Apps package build doesn't time out on protobuf/grpcio). Uses the OAuth token the Apps runtime
injects, or the CLI profile token locally, and calls the Lakebase credential REST API directly.
"""
import os
import subprocess
import json
import requests

_IS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))


def host() -> str:
    h = os.environ.get("DATABRICKS_HOST", "")
    if _IS_APP and h and not h.startswith("http"):
        h = f"https://{h}"
    if h:
        return h.rstrip("/")
    # local: read from CLI profile
    prof = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
    out = subprocess.run(["databricks", "auth", "env", "--profile", prof],
                         capture_output=True, text=True)
    if out.returncode == 0:
        env = json.loads(out.stdout).get("env", {})
        return env.get("DATABRICKS_HOST", "").rstrip("/")
    return ""


def token() -> str:
    """Workspace bearer token.

    In Databricks Apps: mint an OAuth M2M token from the injected service-principal
    credentials (DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET) via the OIDC token endpoint.
    Locally: fall back to the CLI profile token.
    """
    t = os.environ.get("DATABRICKS_TOKEN")
    if t:
        return t
    cid = os.environ.get("DATABRICKS_CLIENT_ID")
    csec = os.environ.get("DATABRICKS_CLIENT_SECRET")
    if cid and csec:
        resp = requests.post(
            f"{host()}/oidc/v1/token",
            auth=(cid, csec),
            data={"grant_type": "client_credentials", "scope": "all-apis"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]
    # local dev
    prof = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
    out = subprocess.run(["databricks", "auth", "token", "--profile", prof],
                         capture_output=True, text=True)
    return json.loads(out.stdout)["access_token"]


def lakebase_credential(endpoint_name: str) -> str:
    """Generate a short-lived Lakebase Postgres OAuth token via the REST API
    (POST /api/2.0/postgres/credentials, body {"endpoint": "<resource-name>"})."""
    resp = requests.post(
        f"{host()}/api/2.0/postgres/credentials",
        headers={"Authorization": f"Bearer {token()}"},
        json={"endpoint": endpoint_name},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["token"]
