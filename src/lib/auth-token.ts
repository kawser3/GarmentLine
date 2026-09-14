/**
 * Holds the access token for the fetch layer.
 *
 * Exists purely to break a circular import: `blocks-api.ts` and the GraphQL gateway need
 * the current token, while the auth store needs `api()` to fetch. Both talk to this tiny
 * module instead of to each other.
 */

let accessToken: string | null = null;
let refreshHook: (() => Promise<boolean>) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Registered by the auth store so the fetch layer can refresh-then-retry on a 401. */
export function setRefreshHook(fn: (() => Promise<boolean>) | null) {
  refreshHook = fn;
}

export async function tryRefresh(): Promise<boolean> {
  if (!refreshHook) return false;
  return refreshHook();
}

/*
 * Persistence note.
 *
 * The token lives in sessionStorage, not memory only, so a page reload does not force a
 * fresh sign-in. That is a deliberate trade-off: web storage is readable by any script on
 * the page, so an XSS bug would expose the token. It is scoped to the tab and cleared when
 * the tab closes, which limits the window. Revisit if this app ever renders untrusted HTML.
 */
const STORAGE_KEY = "blocks-incident.auth";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string | null;
  /** Epoch ms. */
  expiresAt?: number | null;
  /** True when we fell back to the id_token because no access_token was returned. */
  viaIdToken?: boolean;
}

export function loadStoredTokens(): StoredTokens | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTokens;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: StoredTokens | null) {
  try {
    if (!tokens) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Private-browsing modes can throw on write; the session still works in-memory.
  }
}

/**
 * Normalise a token response. Shapes differ between deployments and endpoints — snake_case
 * or camelCase, at the top level or wrapped in `data` — so this reads defensively rather
 * than assuming one layout.
 *
 * Returns null when there is nothing usable, which is a legitimate outcome: some
 * deployments return only an `id_token` and carry the session in an HttpOnly cookie.
 */
export function readTokenResponse(body: unknown): StoredTokens | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const inner = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

  const access =
    str(inner.access_token) ??
    str(inner.accessToken) ??
    str(b.access_token) ??
    str(b.accessToken);

  // Last resort: some Blocks projects hand back only an id_token. Trying it as the bearer
  // costs nothing — /iam/me is the arbiter, so a token the API rejects simply surfaces as
  // "not signed in" rather than silently pretending to work.
  const idToken = str(inner.id_token) ?? str(inner.idToken) ?? str(b.id_token);
  const chosen = access ?? idToken;
  if (!chosen) return null;

  const refresh =
    str(inner.refresh_token) ?? str(inner.refreshToken) ?? str(b.refresh_token);
  const expiresIn = Number(inner.expires_in ?? inner.expiresIn);
  return {
    accessToken: chosen,
    refreshToken: refresh ?? null,
    // `expires_in` is seconds; a bogus/absent value just means "unknown expiry".
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    viaIdToken: !access && Boolean(idToken),
  };
}
