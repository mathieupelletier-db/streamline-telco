"""Foundation Model client (Databricks-served Claude) for the Assist layer."""
import os
from openai import OpenAI
from databricks.sdk import WorkspaceClient

_IS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))
_w = WorkspaceClient() if _IS_APP else WorkspaceClient(
    profile=os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
)
MODEL = os.environ.get("SERVING_ENDPOINT", "databricks-claude-sonnet-4-5")


def _token() -> str:
    if _IS_APP and os.environ.get("DATABRICKS_TOKEN"):
        return os.environ["DATABRICKS_TOKEN"]
    return _w.config.authenticate()["Authorization"].replace("Bearer ", "")


def _host() -> str:
    if _IS_APP:
        h = os.environ.get("DATABRICKS_HOST", "")
        return h if h.startswith("http") else f"https://{h}"
    return _w.config.host


def client() -> OpenAI:
    return OpenAI(api_key=_token(), base_url=f"{_host()}/serving-endpoints")


def chat(messages: list[dict], model: str | None = None, max_tokens: int = 1024,
         temperature: float = 0.3) -> str:
    resp = client().chat.completions.create(
        model=model or MODEL, messages=messages,
        max_tokens=max_tokens, temperature=temperature,
    )
    return resp.choices[0].message.content
