/**
 * Shown instead of the application when required configuration is absent.
 *
 * Deliberately dependency-free — no router, no data layer, no theme context — so it renders
 * even when nothing else can boot. Styling is inline for the same reason: it has to survive a
 * missing stylesheet. This is a dialog, so its width limit is intentional and exempt from the
 * fluid-layout rule.
 */
export function ConfigErrorPage({
  missing,
  hasRuntimeConfig,
}: {
  missing: string[];
  hasRuntimeConfig: boolean;
}) {
  const sans = "'Nunito Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const mono = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "hsl(220, 33%, 96%)",
        color: "hsl(0, 0%, 6%)",
        fontFamily: sans,
        fontSize: 15,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          maxWidth: 620,
          width: "100%",
          background: "#ffffff",
          border: "1px solid hsl(220, 13%, 88%)",
          borderRadius: 6,
          boxShadow: "0 12px 32px rgba(16,24,40,.12)",
          padding: 28,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
          GarmentLine cannot start
        </div>
        <p style={{ color: "hsl(0, 0%, 31%)", marginTop: 6, marginBottom: 20 }}>
          The application is missing configuration it needs before it can connect to SELISE
          Blocks.
        </p>

        <div
          style={{
            border: "1px solid hsl(354, 70%, 44%)",
            background: "hsl(354, 70%, 96%)",
            color: "hsl(354, 70%, 44%)",
            borderRadius: 4,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {missing.length === 1 ? "Missing setting" : `${missing.length} missing settings`}
          </div>
          {missing.map((m) => (
            <div key={m} style={{ fontFamily: mono, fontSize: 13, color: "hsl(0, 0%, 6%)" }}>
              {m}
            </div>
          ))}
        </div>

        <div style={{ color: "hsl(0, 0%, 31%)", fontSize: 14, marginTop: 18 }}>
          {hasRuntimeConfig ? (
            <>
              <p style={{ marginTop: 0 }}>
                Runtime configuration was loaded but did not supply the values above. Set the
                matching environment variables on the deployment — the <code>VITE_</code> prefix
                is optional there.
              </p>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                No runtime configuration was found. Either the container environment variables are
                unset, or the build had no matching <code>.env</code> file for its mode.
              </p>
              <p style={{ color: "hsl(35, 100%, 33%)" }}>
                Note that <code>--mode prod</code> reads <code>.env.prod</code> — a file named{" "}
                <code>.env.production</code> is ignored.
              </p>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid hsl(220, 13%, 88%)",
            fontSize: 13,
            color: "hsl(0, 0%, 52%)",
          }}
        >
          Only the project key and OIDC client id are strictly required — the API address and
          redirect URI are derived from this hostname. Both required values are public
          identifiers.
        </div>
      </div>
    </div>
  );
}
