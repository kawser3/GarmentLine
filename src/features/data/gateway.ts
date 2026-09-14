import { env } from "@/lib/env";
import { getAccessToken, tryRefresh } from "@/lib/auth-token";

const GATEWAY = `${env.apiUrl}/data/v4/gateway`;

export interface ActionResponse {
  acknowledged: boolean;
  itemId?: string | null;
  totalImpactedData: number;
  message?: string | null;
}

export interface GqlResult<T> {
  items: T[];
  totalCount: number;
  pageNo: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export class GraphQLError extends Error {
  constructor(public errors: Array<{ message: string }>) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "GraphQLError";
  }
}

/**
 * Matches a rate-limit reported as a GraphQL error in a 200 body — this gateway does that with
 * auth failures, so it cannot be assumed 429 always arrives as a status code. Safe to retry
 * even for mutations: throttled means rejected, so nothing was applied.
 */
function isRateLimitError(e: { message?: string; extensions?: { code?: string } }) {
  return /too many request|rate ?limit|throttl|\b429\b/i.test(e.message ?? "");
}

/** Matches the gateway's auth failure, which arrives as a GraphQL error, not a 401. */
function isAuthError(e: { message?: string; extensions?: { code?: string } }) {
  return (
    e.extensions?.code === "AUTH_NOT_AUTHENTICATED" ||
    /not authenticated|unauthenticated|unauthorized/i.test(e.message ?? "")
  );
}

/* ------------------------------------------------------------- rate limiting

   The gateway answers 429 when a burst is too fast, and the importer and the wipe page both
   run in bursts: 800+ inserts, 4 at a time. Without handling it, one 429 aborts a row and the
   import finishes "successfully" with rows missing — which is the worst outcome, because the
   totals then look plausible.

   Retry policy is split by safety, not convenience:

     * 429 is always retried. A rate-limited request was REJECTED, not executed, so re-sending
       it cannot double-apply. `Retry-After` is honoured when present.
     * 408/425/502/503/504 and network failures are retried only for QUERIES. For a mutation
       the request may well have been applied before the connection broke, and re-sending an
       insert would create a duplicate row. Better to surface the error than silently double a
       charge.
     * 500 is never retried. On this gateway it means the request was processed and something
       went wrong inside it.

   On a 429 every in-flight caller also backs off, not just the one that was throttled —
   otherwise the other three workers keep hammering while this one waits.
   ---------------------------------------------------------------------- */

const MAX_ATTEMPTS = 6;
/** Retryable only when the operation is a read — see the note above. */
const RETRY_IF_READ = new Set([408, 425, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shared brake: set on a 429 so concurrent callers slow down together. */
let cooldownUntil = 0;

async function waitForCooldown() {
  for (let guard = 0; guard < 100; guard += 1) {
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) return;
    await sleep(Math.min(remaining, 2000));
  }
}

/** `Retry-After` is either seconds or an HTTP date. Returns ms, or null when absent/unusable. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

/** Exponential backoff with jitter, so four workers do not retry in lockstep. */
function backoffMs(attempt: number) {
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base + Math.random() * 250;
}

/** A mutation may have been applied even when the response never arrived. */
const isMutation = (query: string) => /^\s*mutation\b/.test(query);

/**
 * One POST endpoint serves every schema in the project, so no Apollo/urql is needed.
 *
 * Auth is the bearer token from the SSO callback. The schemas default to `User` access
 * level, so an unauthenticated call fails with `AUTH_NOT_AUTHENTICATED` inside a 200-shaped
 * GraphQL error rather than an HTTP 401 — which is why the token matters here even though
 * the request "succeeds".
 *
 * Retries are handled here rather than at each call site, so the importer, the wipe page and
 * the Sync page all get the same behaviour. See the rate-limiting note above.
 */
export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  _retriedAuth = false,
): Promise<T> {
  const mutating = isMutation(query);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForCooldown();

    let res: Response;
    try {
      const token = getAccessToken();
      res = await fetch(GATEWAY, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-blocks-key": env.projectKey, // runtime calls use the PROJECT key
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      // Network-level failure: no response at all.
      lastError = e instanceof Error ? e : new Error(String(e));
      if (mutating || attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.status === 429) {
      const wait = retryAfterMs(res) ?? backoffMs(attempt);
      // Brake every concurrent caller, not just this one.
      cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
      lastError = new Error(`Gateway rate-limited this request (429) after ${attempt} attempt(s).`);
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(wait);
      continue;
    }

    if (res.status === 401 && !_retriedAuth) {
      if (await tryRefresh()) return gql<T>(query, variables, true);
    }

    if (RETRY_IF_READ.has(res.status) && !mutating && attempt < MAX_ATTEMPTS) {
      lastError = new Error(`Gateway ${res.status} on a read; retrying.`);
      await sleep(backoffMs(attempt));
      continue;
    }

    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    // The gateway reports an expired/invalid token as a GraphQL error with HTTP 200, so the
    // status-code retry above never sees it. Catch it here or the user gets a bare
    // "User is not authenticated" instead of a silent, successful refresh.
    if (!_retriedAuth && body.errors?.some((e) => isAuthError(e))) {
      if (await tryRefresh()) return gql<T>(query, variables, true);
    }

    // A throttle dressed as a 200 GraphQL error. Same treatment as a real 429.
    if (body.errors?.some((e) => isRateLimitError(e)) && attempt < MAX_ATTEMPTS) {
      const wait = backoffMs(attempt);
      cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
      lastError = new GraphQLError(body.errors);
      await sleep(wait);
      continue;
    }

    if (body.errors?.length) throw new GraphQLError(body.errors);
    if (!body.data) throw new Error(`Gateway ${res.status}: empty response`);
    return body.data;
  }

  throw lastError ?? new Error("Gateway request failed after retries");
}
