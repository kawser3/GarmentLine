import { create } from "zustand";
import { api, ApiError } from "@/lib/blocks-api";
import { canSignIn, env } from "@/lib/env";
import { isSameSite } from "@/lib/blocks-domain";
import {
  loadStoredTokens,
  readTokenResponse,
  setAccessToken,
  setRefreshHook,
  storeTokens,
  type StoredTokens,
} from "@/lib/auth-token";

/**
 * The roles on a user, flattened.
 *
 * `/iam/me` and the user list disagree on shape: one returns a flat array, the other an
 * org-keyed map like `{ default: ["incident-manager"] }`. Reading only the array form made every
 * user look role-less, which — with an authorisation check on top — fails OPEN or CLOSED
 * depending on which way round the check is written. Both shapes are handled here, once.
 */
export function rolesOf(user: BlocksUser | null | undefined): string[] {
  const raw = user?.roles as unknown;
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === "string");
  if (raw && typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((r): r is string => typeof r === "string");
  }
  return [];
}

/*
 * The roles the brief names, plus an admin. Slugs must match scripts/03-roles-users.mjs,
 * which is what actually creates them - a mismatch fails CLOSED (everything looks
 * unauthorised) rather than open, but it fails silently, so the two lists live side by side.
 */
export const ROLES = {
  superadmin: "superadmin",
  admin: "admin",
  gm: "factory-manager",
  merchandiser: "merchandiser",
  supervisor: "line-supervisor",
  qa: "qa-inspector",
  buyer: "buyer",
} as const;

export type RoleSlug = (typeof ROLES)[keyof typeof ROLES];

/** Human labels, for the sidebar and the role chip. */
export const ROLE_LABELS: Record<string, string> = {
  [ROLES.superadmin]: "Super Administrator",
  [ROLES.admin]: "Administrator",
  [ROLES.gm]: "Factory Manager",
  [ROLES.merchandiser]: "Merchandiser",
  [ROLES.supervisor]: "Line Supervisor",
  [ROLES.qa]: "QA Inspector",
  [ROLES.buyer]: "Buyer",
};

export function hasRole(user: BlocksUser | null | undefined, ...any: RoleSlug[]): boolean {
  const held = rolesOf(user);
  return any.some((r) => held.includes(r));
}

/*
 * Capabilities.
 *
 * Capability answers WHAT MAY I DO; scope (features/issues/scope.ts) answers TO WHICH
 * RECORDS - a merchandiser sees the styles they own, a supervisor the lines they run.
 * Keeping the two apart is what lets the GM see everything without widening anyone else.
 *
 * These gate the UI. IAM holds the same model as permissions server-side; this is the
 * visible half, not the enforcement.
 */
const { superadmin: SA, admin: AD, gm: GM, merchandiser: MD, supervisor: SUP, qa: QA } = ROLES;

/** Everyone who works inside the factory. A Buyer holds none of these. */
export function isInternal(user: BlocksUser | null | undefined): boolean {
  return hasRole(user, SA, AD, GM, MD, SUP, QA);
}

/* -- platform ------------------------------------------------------------- */
export const canManagePlatform = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD);
export const canManagePeople = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM);
export const canManageMasterData = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);

/* -- issue lifecycle ------------------------------------------------------ */
export const canRaiseIssue = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD, SUP, QA);
export const canEditIssue = canRaiseIssue;
export const canAssign = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);
/** Recording that a correction was made is the supervisor's half of the loop. */
export const canRecordCorrection = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD, SUP, QA);
/** Verification is QA's call, per the brief's lifecycle. */
export const canVerifyIssue = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, QA);
export const canCloseIssue = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);

/*
 * The one the brief singles out: "Only authorized people can mark a sample 'approved' -
 * this is a decision of record, not a casual status."
 *
 * Deliberately excludes the line supervisor. A supervisor who could stamp a sample could
 * start bulk against a version the buyer never signed off, which is the failure the whole
 * product exists to prevent.
 */
export const canApproveSample = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);

/** Accepting an AI action item makes it official, so it is the merchandiser's call. */
export const canAcceptActionItem = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);

/* -- management view ------------------------------------------------------ */
/** The brief: "the GM sees everything including cost impact." */
export const canSeeCostImpact = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM);
export const canAcknowledgeAlert = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM);
export const canSeeManagementView = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);

/* -- reports -------------------------------------------------------------- */
export const canShareWithBuyer = (u: BlocksUser | null | undefined) => hasRole(u, SA, AD, GM, MD);
export const canSendBuyerMail = canShareWithBuyer;

export interface BlocksUser {
  itemId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[] | Record<string, string[]>;
  permissions?: string[];
  [k: string]: unknown;
}

type Status = "unknown" | "authenticated" | "anonymous";

/**
 * The callback succeeded but the session still isn't usable. Kept as a distinct error
 * because "IAM rejected the sign-in" and "sign-in worked but we can't authenticate calls"
 * have completely different causes.
 */
export class SessionNotEstablishedError extends Error {
  constructor(public callbackDetail: string) {
    super("Sign-in completed, but no usable session was established.");
    this.name = "SessionNotEstablishedError";
  }
}

/**
 * The account exists but cannot be signed in to yet — it is waiting to be activated.
 *
 * Deliberately NOT a rejection to bounce back to /login. There is nothing the person can do
 * differently at a sign-in page, so returning them to one invites them to try the same thing
 * forever with no explanation. They are held on a screen that says what is happening and who
 * has to act.
 */
export class PendingActivationError extends Error {
  constructor(public email: string) {
    super("Your account is pending activation.");
    this.name = "PendingActivationError";
  }
}

interface AuthState {
  status: Status;
  user: BlocksUser | null;
  error: string | null;
  /** Probe the current token. Called on page load. */
  loadSession: () => Promise<void>;
  /** Step 1-2 of the hosted flow: ask IAM for the authorize URL, then navigate to it. */
  login: () => Promise<void>;
  /** Step 4: exchange code+state for tokens. */
  completeLogin: (code: string, state: string) => Promise<void>;
  /** Exchange the refresh token for a new access token. Used as the 401-retry path. */
  refreshSession: () => Promise<boolean>;
  logout: () => Promise<void>;
}

function applyTokens(tokens: StoredTokens | null) {
  setAccessToken(tokens?.accessToken ?? null);
  storeTokens(tokens);
}

/**
 * Names of the fields a response actually contained, for diagnostics. Far more useful than a
 * truncated JSON dump, where a long id_token pushes every other key out of view — which is
 * exactly how a response was misread as having no access_token.
 */
function describeKeys(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  const nested =
    b.data && typeof b.data === "object"
      ? ` (data: ${Object.keys(b.data as object).join(", ")})`
      : "";
  return `${keys.join(", ") || "none"}${nested}`;
}

/*
 * End the identity provider's own session, best effort — the half of logout the API
 * gateway cannot do for us.
 *
 * `/iam/v4/auth/Logout` clears the Blocks session, but the cookie that lets the hosted
 * login page sign you straight back in is scoped to the IdP host, and the IdP publishes
 * no end_session_endpoint nor honours prompt=login (both probed 5 Sept 2026 — see the
 * PLAN §06 callout). What it does have is the endpoint its own login page calls to end
 * a session: POST /api/auth/logout on the IdP host. A no-cors fetch with credentials is
 * the only way a cross-origin page can send that POST: the response is opaque, but the
 * request carries the IdP's cookie when that cookie is SameSite=None — the normal choice
 * for an SSO provider — and the server clears the session. When the cookie is Lax the
 * beacon goes out cookieless and nothing changes; it can never make things worse.
 *
 * keepalive so the request survives the logout navigation that usually follows.
 */
function idpSessionLogout() {
  try {
    void fetch(`${env.idpUrl}/api/auth/logout?tenant_id=${encodeURIComponent(env.projectKey)}`, {
      method: "POST",
      mode: "no-cors",
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // Best effort by design: a beacon that cannot be sent leaves behaviour exactly as
    // it was, and the local session is already gone.
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Rehydrate before the first render so a page reload doesn't bounce to /login.
  const restored = loadStoredTokens();
  if (restored) setAccessToken(restored.accessToken);

  // Let the fetch layer trigger a refresh on 401 without importing this store.
  setRefreshHook(() => get().refreshSession());

  return {
    status: "unknown",
    user: null,
    error: null,

    async loadSession() {
      // Always probe, even with no stored token: the session may be carried by the
      // HttpOnly cookie instead. Short-circuiting here made a cookie-based deployment
      // look permanently signed out without ever asking the server.
      try {
        const res = await api<{ data?: BlocksUser } | BlocksUser>("/iam/v4/iam/me");
        const user = (res as { data?: BlocksUser }).data ?? (res as BlocksUser);
        set({ status: "authenticated", user, error: null });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          applyTokens(null);
          set({ status: "anonymous", user: null });
          return;
        }
        // A network/CORS failure is NOT "logged out" — surface it rather than bouncing
        // to a login page that will fail the same way.
        set({ status: "anonymous", user: null, error: (e as Error).message });
      }
    },

    async login() {
      set({ error: null });
      // Checked here rather than at module scope, so a build with no OIDC client still renders
      // the login page and says what is missing. Without the check IAM answers with an opaque
      // rejection that names nothing.
      if (!canSignIn) {
        set({
          error:
            "Sign-in is not configured for this deployment. Run " +
            "`node scripts/02-oidc-client.mjs` to register an OIDC client, then set " +
            "VITE_BLOCKS_OIDC_CLIENT_ID in the env file for this mode.",
        });
        return;
      }
      try {
        // /idp/initiate is a fetch, not a navigation. x-blocks-key must be sent as BOTH
        // a query param and a header — omitting either makes the call fail.
        const res = await api<{ redirect_uri?: string }>("/iam/v4/idp/initiate", {
          anonymous: true,
          query: {
            "x-blocks-key": env.projectKey,
            clientId: env.oidcClientId,
            redirectUri: env.redirectUri,
          },
        });
        if (!res.redirect_uri) throw new Error("IAM did not return an authorize URL");
        window.location.assign(res.redirect_uri);
      } catch (e) {
        set({ error: `Could not start sign-in: ${(e as Error).message}` });
      }
    },

    async completeLogin(code, state) {
      let body: unknown;
      try {
        // Response shape varies by deployment: { access_token, refresh_token, … } in the
        // body on some, only { id_token } plus a session cookie on others. Handled below.
        body = await api("/iam/v4/idp/callback", { anonymous: true, query: { code, state } });
      } catch (e) {
        throw new Error(`The IAM callback rejected the sign-in: ${(e as Error).message}`);
      }

      /*
       * What the callback returns depends on the REDIRECT URI's domain, not the API host:
       *
       *   redirect to a verified Blocks app domain (cookieDomain set)
       *       -> { id_token } only; the real session is an HttpOnly cookie
       *   redirect to an unregistered origin such as localhost
       *       -> { access_token, refresh_token } in the body
       *
       * Order matters. An `id_token` is NOT an access token, and sending it as a bearer
       * makes IAM reject the request outright instead of honouring the cookie — so trying it
       * first actively breaks the cookie deployment. Cookie first, id_token only as a last
       * resort, and /iam/me decides.
       */
      const tokens = readTokenResponse(body);

      if (tokens && !tokens.viaIdToken) {
        applyTokens(tokens);
        await get().loadSession();
      } else {
        // Cookie path: probe with NO Authorization header at all.
        applyTokens(null);
        await get().loadSession();

        // Only if the cookie got us nowhere, try the id_token as a bearer.
        if (get().status !== "authenticated" && tokens?.viaIdToken) {
          applyTokens(tokens);
          await get().loadSession();
          if (get().status !== "authenticated") applyTokens(null);
        }
      }

      if (get().status !== "authenticated") {
        const sameSite = isSameSite(new URL(env.apiUrl).hostname, window.location.hostname);
        throw new SessionNotEstablishedError(
          [
            `Callback fields: ${describeKeys(body)}.`,
            tokens?.viaIdToken
              ? "Only an id_token was returned, so this deployment uses a cookie session."
              : tokens
                ? "An access_token was returned but /iam/v4/iam/me rejected it."
                : "No token was returned, so this deployment uses a cookie session.",
            sameSite
              ? `API ${env.apiUrl} is same-site with this app, so the cookie should have been sent — ` +
                `check whether the callback response actually carried Set-Cookie.`
              : `API ${env.apiUrl} is NOT same-site with ${window.location.hostname}, so a ` +
                `cookie scoped to this app's domain is never sent to it. Point ` +
                `VITE_BLOCKS_API_URL at blocksapi.${window.location.hostname.split(".").slice(-2).join(".")} instead.`,
          ].join(" "),
        );
      }
    },

    async refreshSession() {
      const stored = loadStoredTokens();
      if (!stored?.refreshToken) {
        applyTokens(null);
        set({ status: "anonymous", user: null });
        return false;
      }
      try {
        const body = await api("/iam/v4/oidc/token", {
          anonymous: true,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: env.oidcClientId,
            refresh_token: stored.refreshToken,
          }).toString(),
        });
        const tokens = readTokenResponse(body);
        if (!tokens) throw new Error("refresh response contained no access_token");
        // Blocks may not return a new refresh token; keep the existing one if so.
        applyTokens({ ...tokens, refreshToken: tokens.refreshToken ?? stored.refreshToken });
        return true;
      } catch {
        applyTokens(null);
        set({ status: "anonymous", user: null });
        return false;
      }
    },

    async logout() {
      try {
        await api("/iam/v4/auth/Logout", { method: "POST", body: JSON.stringify({}) });
      } finally {
        // Always drop local state, even if the server call fails, so the UI reflects
        // a signed-out session.
        applyTokens(null);
        set({ status: "anonymous", user: null });
      }
      idpSessionLogout();
    },
  };
});
