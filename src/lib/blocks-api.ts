import { env } from "./env";
import { getAccessToken, tryRefresh } from "./auth-token";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The human-readable reason out of a Blocks IAM error envelope.
 *
 * `errors` is checked before `message` because that is where IAM actually puts the detail. A
 * refused request returns something like
 *
 *   {"isSuccess":false,"errors":{"OldPassword":"The current password is incorrect"}}
 *
 * — with `message` left `null`. Reading `message` first (as this function's caller used to)
 * finds nothing, falls through every other field, and lands on `res.statusText` — which for a
 * plain 403 is just the word "Forbidden", with the one sentence that says WHY thrown away.
 * `error`/`error_description` stay as fallbacks for the plain OAuth-shaped error bodies a token
 * exchange can return, which use that shape instead.
 */
export function envelopeError(body: unknown, fallback: string): string {
  const b = body as
    | { errors?: Record<string, string>; message?: string; error_description?: string; error?: string }
    | undefined;
  const fromErrors = b?.errors ? Object.values(b.errors).filter(Boolean) : [];
  if (fromErrors.length) return fromErrors.join(" ");
  return b?.message ?? b?.error_description ?? b?.error ?? fallback;
}

/**
 * Fetch against a Blocks REST service.
 *
 * Auth is a **bearer token**, not a cookie. `/iam/v4/idp/callback` returns
 * `{ access_token, refresh_token, … }` in its response body for this project — it does not
 * set a session cookie, despite what the SSO docs describe. `credentials: "include"` is kept
 * anyway so a cookie-based deployment would still work, but the token is what authenticates.
 */
export async function api<T>(
  path: string,
  init: RequestInit & {
    query?: Record<string, string | undefined>;
    /** Internal: prevents an infinite refresh loop. */
    _retried?: boolean;
    /** Skip the Authorization header (e.g. account activation, which uses no session). */
    anonymous?: boolean;
  } = {},
): Promise<T> {
  const { query, _retried, anonymous, ...rest } = init;
  let url = `${env.apiUrl}${path}`;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter((e): e is [string, string] => e[1] != null),
    );
    if ([...qs].length) url += `?${qs}`;
  }

  const token = anonymous ? null : getAccessToken();
  const res = await fetch(url, {
    ...rest,
    credentials: "include",
    headers: {
      "x-blocks-key": env.projectKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
  });

  // Refresh-then-retry once. Guarded so a failing refresh cannot recurse.
  if (res.status === 401 && !_retried && !anonymous && token) {
    if (await tryRefresh()) {
      return api<T>(path, { ...init, _retried: true });
    }
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(`${res.status} ${envelopeError(body, res.statusText)}`, res.status, body);
  }
  return body as T;
}
