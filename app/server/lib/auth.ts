import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';

/**
 * Build the Authorization header for an outbound Databricks call.
 *
 * - Prod: Databricks Apps injects `x-forwarded-access-token` for OBO — use it
 *   so the call is attributed to the viewing user (MLflow traces, audit logs,
 *   UC permissions).
 * - Dev / no forwarded token: delegate to the SDK's auth chain via the
 *   current WorkspaceClient. This picks up the CLI profile, handles OAuth
 *   refresh automatically (no more 1-hour token expiry), works with service
 *   principal creds, Azure CLI, etc. — whatever the user's local config is.
 *
 * Callers do `const headers = await authHeaders(req); h.set('Content-Type', ...)`
 * and pass `headers` straight to `fetch()`.
 */
export async function authHeaders(req: Request): Promise<Headers> {
  const h = new Headers();
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken) {
    h.set('Authorization', `Bearer ${userToken}`);
    return h;
  }
  const { client } = getExecutionContext();
  await client.config.authenticate(h);
  return h;
}

/**
 * Build the Authorization header using the APP'S SERVICE PRINCIPAL, never the
 * forwarded user token.
 *
 * Why this exists separately from `authHeaders`: the OBO user token is minted
 * as `(app user_api_scopes) ∩ (what the user consented to)`. For the LLM leg
 * (OpenAI Agents loop → `/serving-endpoints/chat/completions`) that dependency
 * on a fresh per-user `model-serving` consent is fragile — a stale grant makes
 * the serving gateway reject the call with `Invalid scope, required scopes:
 * model-serving` even after the app's scopes are correct. The app SP's token
 * (injected `DATABRICKS_CLIENT_ID/SECRET`, broad `all-apis`) carries
 * model-serving implicitly and needs no user consent, so the assistant works
 * for every viewer. Genie / Lakebase / analytics keep using `authHeaders`
 * (OBO) so those stay attributed + governed per user.
 */
export async function servicePrincipalAuthHeaders(): Promise<Headers> {
  const h = new Headers();
  const { client } = getExecutionContext();
  await client.config.authenticate(h);
  return h;
}
