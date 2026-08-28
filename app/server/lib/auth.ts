import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';

/**
 * fetch() wrapper that retries once with the app SERVICE-PRINCIPAL token when a
 * call made with the forwarded OBO user token comes back 401/403. This is the
 * same recovery the OpenAI fetch shim in agent/plantfloor.ts does, factored out
 * so REST tool calls (Genie start-conversation + poll) get the SAME resilience.
 *
 * `req` is the incoming request (to know whether we're on the user-token path);
 * `authedHeaders` are the headers already built via authHeaders(req) (Content-Type
 * etc. preserved). On the SP retry we swap only the Authorization header.
 *
 * Non-user-token (dev/SP) callers pass through with no retry. If the SP mint
 * fails, the original (failed) response is returned so the caller's existing
 * error handling still runs.
 */
export async function fetchWithSpFallback(
  req: Request,
  authedHeaders: Headers,
  input: string,
  init: Omit<RequestInit, 'headers'>,
): Promise<Response> {
  const resp = await fetch(input, { ...init, headers: authedHeaders });
  const onUserToken = !!req.headers['x-forwarded-access-token'];
  if ((resp.status === 401 || resp.status === 403) && onUserToken) {
    const sp = await servicePrincipalBearer();
    if (sp) {
      console.warn(
        `[auth] ${resp.status} on ${input.split('?')[0]} with user token — retrying with SP token`,
      );
      const retryHeaders = new Headers(authedHeaders);
      retryHeaders.set('Authorization', `Bearer ${sp}`);
      return fetch(input, { ...init, headers: retryHeaders });
    }
  }
  return resp;
}

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
 * ── Keep this DUMB — no service-principal / oauth-m2m special-casing here ────
 * When this app runs against a REMOTE TARGET workspace (cross-workspace deploy),
 * the launcher authenticates it as the deployer service principal purely via
 * ENV: it sets DATABRICKS_AUTH_TYPE=oauth-m2m + DATABRICKS_CLIENT_ID/SECRET +
 * DATABRICKS_HOST for the target and REMOVES DATABRICKS_TOKEN from the child's
 * env. So the SDK's default credential chain (below) resolves oauth-m2m on its
 * own — every path in this app (this helper, execSql, mlflow, warehouse, the
 * Lakebase pool) authenticates correctly with ZERO app-side auth logic. Do NOT
 * re-introduce a pinned WorkspaceClient here: the env is the single source of
 * truth (see the generator's core/auth.py). An earlier fix pinned oauth-m2m in
 * this file to work around a PRESENT-but-empty DATABRICKS_TOKEN; that empty
 * token is no longer injected, so the workaround is unnecessary and would only
 * risk drift between this file and its ~10 shipped copies.
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
 * Mint an app SERVICE-PRINCIPAL bearer via the OAuth client-credentials flow,
 * straight from the DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET / DATABRICKS_HOST
 * env vars the Apps runtime injects. This is the FALLBACK when the forwarded OBO
 * user token (`x-forwarded-access-token`) is expired — the Apps proxy hands the
 * container a short-lived (~1h) user token and does NOT always refresh it, so a
 * long-lived tab or a re-synced identity yields a token the gateway rejects with
 * `401 invalid_token "The access token expired"`. The gateway call still carries
 * a `user=<email>` request tag, so per-user attribution survives the fallback.
 *
 * Why a raw /oidc/v1/token POST instead of the SDK's credential chain: the
 * container also carries a stray `.databrickscfg` PAT alongside the oauth-m2m
 * env, so `client.config.authenticate()` trips "more than one authorization
 * method configured: oauth and pat". Going straight to the token endpoint with
 * explicit Basic auth sidesteps that entirely.
 *
 * Returns null (never throws) if the env vars are absent or the mint fails, so
 * callers can degrade gracefully.
 */
let _spBearerCache: { token: string; expiresAt: number } | null = null;
export async function servicePrincipalBearer(): Promise<string | null> {
  // Reuse a still-valid minted token (60s safety margin) to avoid a token
  // round-trip on every fallback within a turn.
  if (_spBearerCache && _spBearerCache.expiresAt - 60_000 > Date.now()) {
    return _spBearerCache.token;
  }
  const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '');
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!host || !clientId || !clientSecret) return null;
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const resp = await fetch(`${host}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    });
    if (!resp.ok) {
      console.error(
        `[auth] SP token mint failed: ${resp.status} ${resp.statusText} — ${(await resp.text().catch(() => '')).slice(0, 300)}`,
      );
      return null;
    }
    const j = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    _spBearerCache = {
      token: j.access_token,
      expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
    };
    return j.access_token;
  } catch (e) {
    console.error('[auth] SP token mint threw', e);
    return null;
  }
}
