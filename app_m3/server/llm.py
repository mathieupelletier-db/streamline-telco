"""Foundation Model client (Databricks-served Claude) for the Assist layer — SDK-free."""
import os
from openai import OpenAI
from . import auth

MODEL = os.environ.get("SERVING_ENDPOINT", "databricks-claude-sonnet-4-5")


def client() -> OpenAI:
    return OpenAI(api_key=auth.token(), base_url=f"{auth.host()}/serving-endpoints")


def chat(messages: list[dict], model: str | None = None, max_tokens: int = 1024,
         temperature: float = 0.3) -> str:
    resp = client().chat.completions.create(
        model=model or MODEL, messages=messages,
        max_tokens=max_tokens, temperature=temperature,
    )
    return resp.choices[0].message.content
