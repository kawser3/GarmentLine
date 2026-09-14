/**
 * Pure host→endpoint derivation, kept separate from `env.ts` so it can be tested without
 * a browser or a built bundle. `env.ts` reads `import.meta.env` at module scope, which
 * makes it awkward to exercise directly.
 */

/**
 * The registrable domain — last two labels. Correct for the domains Blocks issues
 * (`*.slsblx.com`, `*.seliseblocks.com`, `*.seliselocal.com`). It would be wrong for a
 * multi-part public suffix such as `co.uk`, so set the API URL explicitly on such a domain.
 */
export function registrableDomain(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/**
 * Where the Blocks API lives for an app served on `host`.
 *
 * Returns undefined for hosts with no registrable domain (localhost, bare IPs) — those must
 * configure the API URL explicitly, which local dev does by pointing at the vite proxy.
 *
 * Deriving this rather than hardcoding it means one build runs on the Blocks-provided domain
 * and on a custom domain unchanged, and the API host is same-site with the app by
 * construction instead of by remembering to configure it.
 */
export function deriveApiUrl(host: string): string | undefined {
  // An IP address has no registrable domain. Checking only for a dot is not enough:
  // "127.0.0.1" would yield the nonsense host "blocksapi.0.1".
  if (/^\d+(\.\d+)*$/.test(host) || host.includes(":")) return undefined;

  const domain = registrableDomain(host);
  if (!domain || !domain.includes(".")) return undefined;
  // A numeric TLD is never a real public suffix.
  if (/^\d+$/.test(domain.split(".").pop() ?? "")) return undefined;
  // Apps on seliseblocks.com use api.<domain>; every other Blocks domain uses blocksapi.<domain>.
  return domain === "seliseblocks.com"
    ? "https://api.seliseblocks.com"
    : `https://blocksapi.${domain}`;
}

/** True when the API host and the app host share a registrable domain. */
export function isSameSite(apiHost: string, appHost: string): boolean {
  return registrableDomain(apiHost) === registrableDomain(appHost);
}
