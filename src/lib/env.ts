/**
 * Runtime configuration, resolved in priority order:
 *
 *   1. window.__BLOCKS_CONFIG__  — written by the container entrypoint from Kubernetes
 *      env vars, so one image works across dev/stg/prod without a rebuild.
 *   2. import.meta.env.VITE_*    — baked in at build time (local dev via .env.local).
 *   3. a derived same-site default, for apiUrl and redirectUri only.
 *
 * Vite inlines VITE_* at build time while the Blocks pipeline supplies configuration at
 * runtime, so relying on build-time values alone would make a deployed image ignore the
 * portal's settings entirely.
 */

import { deriveApiUrl, isSameSite } from "./blocks-domain";

interface RuntimeConfig {
  apiUrl?: string;
  projectKey?: string;
  oidcClientId?: string;
  microsoftClientId?: string;
  redirectUri?: string;
  idpUrl?: string;
  aiModelName?: string;
  aiModelProvider?: string;
}

declare global {
  interface Window {
    __BLOCKS_CONFIG__?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig = (typeof window !== "undefined" && window.__BLOCKS_CONFIG__) || {};

function pick(runtimeValue: string | undefined, buildValue: string | undefined) {
  const v = (runtimeValue || buildValue || "").trim();
  return v || undefined;
}

/**
 * Missing settings are collected rather than thrown. Throwing at module scope produced a
 * blank page with only a minified stack trace in the console — useless on a deployed build.
 * main.tsx renders `configError` as a readable diagnostic instead, listing everything that
 * is missing at once rather than only the first failure.
 */
const missing: string[] = [];

function required(name: string, value: string | undefined): string {
  if (!value) {
    missing.push(name);
    return "";
  }
  return value;
}

// Blank in .env.dev on purpose: derived from the serving hostname so one build runs on the
// Blocks-provided domain and on a custom domain unchanged.
const apiUrl =
  pick(runtime.apiUrl, import.meta.env.VITE_BLOCKS_API_URL) ??
  (typeof window !== "undefined" ? deriveApiUrl(window.location.hostname) : undefined);

const redirectUri =
  pick(runtime.redirectUri, import.meta.env.VITE_BLOCKS_REDIRECT_URI) ??
  (typeof window !== "undefined" ? `${window.location.origin}/login/callback` : undefined);

const hasRuntimeConfig = Object.values(runtime).some((v) => typeof v === "string" && v !== "");

export const env = {
  apiUrl: required("VITE_BLOCKS_API_URL", apiUrl).replace(/\/+$/, ""),
  /** The project tenantId, sent as x-blocks-key on every runtime call. Public. */
  projectKey: required(
    "VITE_BLOCKS_PROJECT_KEY",
    pick(runtime.projectKey, import.meta.env.VITE_BLOCKS_PROJECT_KEY),
  ),
  /**
   * Needed to SIGN IN — and every page here needs a session, so this is close to fatal.
   *
   * It is still deliberately NOT `required`, because the two failures want different pages.
   * A missing PROJECT KEY is unrecoverable and gets the configuration diagnostic. A missing
   * client id gets the login page, which says exactly which script registers one — a reader
   * who lands there can act on it, where a generic config screen would just say "something
   * is unset".
   */
  oidcClientId: pick(runtime.oidcClientId, import.meta.env.VITE_BLOCKS_OIDC_CLIENT_ID) ?? "",
  /** Must exactly match a redirectUri registered on the OIDC client. */
  redirectUri: required("VITE_BLOCKS_REDIRECT_URI", redirectUri),
  /**
   * The Entra app registration's client id, for the Microsoft sign-in button.
   *
   * Public by construction — it travels in the authorization URL to Microsoft on every login
   * — so it belongs in browser config. The client SECRET does not, and never appears here;
   * Blocks holds it against the identity provider record.
   *
   * Optional, like the OIDC client id: a build without it is a working app whose Microsoft
   * button is simply absent, rather than a configuration error page.
   */
  microsoftClientId: pick(runtime.microsoftClientId, import.meta.env.VITE_MS_CLIENT_ID) ?? "",
  /**
   * The identity provider's own host — where the hosted login page lives and where its
   * session cookie is scoped. The app's logout fires a best-effort beacon at it (see the
   * auth store): the API gateway's Logout clears the Blocks session, but the IdP session
   * that silently signs you back in belongs to THIS origin, and nothing on the API can
   * reach it. Default is the host the OIDC provider's own wellKnownUrl already uses.
   */
  idpUrl:
    pick(runtime.idpUrl, import.meta.env.VITE_BLOCKS_IDP_URL) ?? "https://iam.seliseblocks.com",
  /**
   * The AI service model the buyer-comment parser queries (agents.seliseblocks.com,
   * /api/ai-agent/query/stream). Defaults are the pair the service accepts from a browser
   * session: the bedrock-hosted Claude models are listed by /api/agents/models but the
   * query endpoint rejects the `anthropic_bedrock` provider, so the default is a chat
   * model on a provider it does accept. Both overridable without a code change.
   */
  aiModelName:
    pick(runtime.aiModelName, import.meta.env.VITE_BLOCKS_AI_MODEL_NAME) ??
    "deepseek/deepseek-v4-flash-0731",
  aiModelProvider:
    pick(runtime.aiModelProvider, import.meta.env.VITE_BLOCKS_AI_MODEL_PROVIDER) ?? "openai",
} as const;

/** False when sign-in cannot work because no OIDC client is configured for this build. */
export const canSignIn = Boolean(env.oidcClientId);

/** True when the Microsoft button should be offered. */
export const canSignInWithMicrosoft = Boolean(env.microsoftClientId);

/**
 * Non-null when the app cannot start. Rendered by main.tsx as a diagnostic page, including
 * where each value is meant to come from — the same crash previously showed nothing but a
 * minified stack trace.
 */
export const configError: { missing: string[]; hasRuntimeConfig: boolean } | null =
  missing.length ? { missing, hasRuntimeConfig } : null;

if (!configError && typeof window !== "undefined") {
  // Informational, not an error: a cross-site API host only breaks a COOKIE session. This
  // project issues bearer tokens (isCookieEnable is false), so the deployed build pins a
  // cross-site host on purpose. Logged at info level so it does not read as a fault.
  const apiHost = new URL(env.apiUrl).hostname;
  if (!isSameSite(apiHost, window.location.hostname)) {
    console.info(
      `[garmentline] API host ${apiHost} is not same-site with ${window.location.hostname}. ` +
        `Fine for bearer-token auth; a cookie-based session would be dropped.`,
    );
  }
  if (!env.redirectUri.startsWith(window.location.origin)) {
    console.warn(
      `[garmentline] redirectUri ${env.redirectUri} does not match this origin ` +
        `${window.location.origin}. IAM will reject the authorize request unless the ` +
        `URI is registered and intentional.`,
    );
  }
  if (!canSignIn) {
    console.info(
      `[garmentline] No VITE_BLOCKS_OIDC_CLIENT_ID — the issue log is unreachable, ` +
        `because every page needs a session. Run ` +
        `node scripts/02-oidc-client.mjs and put the client id in the .env file for this mode.`,
    );
  }
}
