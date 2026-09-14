import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Blocks service prefixes proxied to the API in local dev.
 *
 * A prefix missing here does not fail like a network error — the dev server owns the path, so
 * the call 404s against Vite itself and looks like a wrong URL in the app. `/logic` was absent
 * until sending a quote by mail became the first thing to call that service.
 *
 * Keep this in step with the services the app actually uses.
 */
const BLOCKS_PREFIXES = [
  "/iam",
  "/data",
  "/os",
  "/logic", // Workflow webhooks and Mail/Send
  "/monitor", // Monitor uptime and health
  "/localization", // Language/Gets and the UILM key file the i18n overlay reads
  "/utilities", // Magic links for the buyer-facing approval report
];

/** Deploy modes, each tied to a branch and an env file of the same name. */
const DEPLOY_MODES = ["dev", "stg", "prod"] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Vite reads `.env.<mode>` and nothing else, so a mode/filename mismatch yields a build
  // with no configuration at all and no error — which is how a deployed bundle ended up
  // missing its project key. Say so at build time rather than in the browser.
  if ((DEPLOY_MODES as readonly string[]).includes(mode)) {
    const file = `.env.${mode}`;
    if (!fs.existsSync(path.resolve(file))) {
      throw new Error(
        `Building --mode ${mode} but ${file} does not exist. Vite only reads .env.${mode}, ` +
          `so this build would contain no configuration.`,
      );
    }
    if (!env.VITE_BLOCKS_PROJECT_KEY) {
      console.warn(
        `\n[garmentline] ${file} has no VITE_BLOCKS_PROJECT_KEY.\n` +
          `  The build will succeed, but the app will show its configuration diagnostic\n` +
          `  unless the deployment supplies BLOCKS_PROJECT_KEY as a runtime env var.\n` +
          `  (.env.stg and .env.prod ship blank on purpose — fill them in when those\n` +
          `  Blocks projects exist, so they never point at the dev project.)\n`,
      );
    }
  }

  // Two local-dev modes:
  //
  //  localhost (default) — plain http on localhost, with the Blocks API reverse-proxied
  //    through this same origin. The SSO callback sets a Secure cookie carrying a
  //    `Domain=` attribute scoped to the Blocks domain, and a browser will not store that
  //    for a localhost origin. Proxying makes the API same-origin and `cookieDomainRewrite`
  //    strips the Domain attribute, so the session cookie is accepted and replayed.
  //    (localhost counts as a trustworthy origin, so `Secure` itself is fine over http.)
  //
  //  domain — set VITE_DEV_DOMAIN to serve https on the project's real domain instead,
  //    talking to the API directly. Needs `npm run cert` and a hosts entry.
  const domain = env.VITE_DEV_DOMAIN?.trim();
  const host = domain || "localhost";
  const port = Number(env.VITE_DEV_PORT ?? 5173);
  const proxyTarget = env.VITE_BLOCKS_PROXY_TARGET?.trim();

  const keyPath = path.resolve(".cert/dev-key.pem");
  const certPath = path.resolve(".cert/dev-cert.pem");
  const useHttps = Boolean(domain) && fs.existsSync(keyPath) && fs.existsSync(certPath);

  if (domain && !useHttps) {
    console.warn(
      `\n[garmentline] VITE_DEV_DOMAIN=${domain} but no cert in .cert/ — serving HTTP.\n` +
        `  SSO will not work on a domain over http. Run \`npm run cert\`.\n`,
    );
  }

  // Without a proxy target, a localhost dev server would call the Blocks API cross-site and
  // silently never receive the session cookie. Fail loudly instead of debugging 401s.
  if (!domain && !proxyTarget) {
    console.warn(
      `\n[garmentline] Running on localhost with no VITE_BLOCKS_PROXY_TARGET.\n` +
        `  Authenticated calls will 401: the Blocks session cookie is domain-scoped and\n` +
        `  cannot be stored for a localhost origin without the same-origin proxy.\n` +
        `  Set VITE_BLOCKS_PROXY_TARGET=https://blocksapi.seliselocal.com in .env.local.\n`,
    );
  }

  const proxy: Record<string, ProxyOptions> = {};
  if (!domain && proxyTarget) {
    for (const prefix of BLOCKS_PREFIXES) {
      proxy[prefix] = {
        target: proxyTarget,
        changeOrigin: true, // send Host: blocksapi… so the API routes/validates correctly
        secure: true,
        // The crux: drop the `Domain=` attribute so the browser scopes the cookie to
        // localhost. Left intact, a cookie scoped to the Blocks domain is rejected outright.
        //
        // Everything else is deliberately left ALONE. `Secure` in particular must survive:
        // localhost is a "potentially trustworthy" origin, so browsers accept Secure cookies
        // over plain http there — and if the cookie name carries a `__Secure-` or `__Host-`
        // prefix, removing Secure makes the browser reject the cookie outright. Stripping it
        // "to be safe" is what breaks the session. `SameSite=None` stays for the same reason
        // (it is only valid alongside Secure) and is harmless on a same-origin request.
        cookieDomainRewrite: "",
        configure: (proxyServer) => {
          // Vite turns a proxy failure into a bare 503 with nothing logged, which is
          // impossible to diagnose. Surface the underlying cause.
          proxyServer.on("error", (err, req) => {
            console.error(
              `[proxy] ${req.method} ${req.url} -> ${proxyTarget} failed: ${err.message}`,
            );
          });
          // cookieDomainRewrite already removes Domain=; this only reports what came back,
          // because "the cookie was silently rejected" is otherwise invisible.
          proxyServer.on("proxyRes", (proxyRes, req) => {
            const setCookie = proxyRes.headers["set-cookie"];
            if (!setCookie?.length) return;
            for (const c of setCookie) {
              const name = c.split("=")[0];
              console.log(`[proxy] ${req.url} set cookie ${name} -> ${c.replace(/=[^;]*/, "=…")}`);
            }
          });
        },
      };
    }

    /*
     * The AI service is its own host (agents.seliseblocks.com), not a prefix on the API
     * gateway. Same-origin proxying for the same reason as above: the session token is
     * sent as a header, but a cross-site call would still need CORS the service does not
     * advertise. `/agents-api/ai-agent/…` becomes `/api/ai-agent/…` on the target.
     */
    const agentsTarget =
      env.VITE_BLOCKS_AGENTS_TARGET?.trim() || "https://agents.seliseblocks.com";
    proxy["/agents-api"] = {
      target: agentsTarget,
      changeOrigin: true,
      secure: true,
      rewrite: (p) => p.replace(/^\/agents-api/, "/api"),
      configure: (proxyServer) => {
        proxyServer.on("error", (err, req) => {
          console.error(`[proxy] ${req.method} ${req.url} -> ${agentsTarget} failed: ${err.message}`);
        });
      },
    };
  }

  /*
   * WSL2 cannot receive inotify events for files on a mounted Windows drive, so a project
   * under /mnt/c or /mnt/f gets no HMR at all — edits simply never reach the browser, and the
   * dev server reports nothing wrong. That is a genuinely confusing failure: the page looks
   * stale in exactly the way a caching bug does, and restarting the server "fixes" it, which
   * sends you looking in the wrong place.
   *
   * Polling costs CPU, so it is switched on only for the case that needs it rather than
   * unconditionally.
   */
  const onWindowsMount = __dirname.startsWith("/mnt/");

  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      host,
      port,
      strictPort: true, // the port is part of the registered redirectUri — never let it drift
      allowedHosts: [host],
      ...(onWindowsMount
        ? { watch: { usePolling: true, interval: 300 } }
        : {}),
      ...(useHttps
        ? {
            https: { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
            hmr: { host, protocol: "wss", clientPort: port },
          }
        : {}),
      ...(Object.keys(proxy).length ? { proxy } : {}),
    },
  };
});
