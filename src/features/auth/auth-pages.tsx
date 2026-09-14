import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { LogIn } from "lucide-react";
import { canSignIn } from "@/lib/env";
import {
  ROLE_LABELS,
  ROLES,
  hasRole,
  isInternal,
  rolesOf,
  SessionNotEstablishedError,
  useAuthStore,
  type RoleSlug,
} from "@/stores/auth";
import { Alert, Button, Loading } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { useT } from "@/features/i18n/i18n";
import type { DictKey } from "@/features/i18n/dictionary";

/**
 * Where someone lands once signed in.
 *
 * A Buyer has no management view to read - their whole surface is the samples and issues on their own
 * services — so sending them to /dashboard would greet them with an access refusal on the
 * first screen they ever see.
 */
function afterSignIn(): string {
  const user = useAuthStore.getState().user;
  return isInternal(user) ? "/dashboard" : "/issues";
}

/** Probe the session once on mount. */
export function useSessionBootstrap() {
  const status = useAuthStore((s) => s.status);
  const loadSession = useAuthStore((s) => s.loadSession);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadSession();
  }, [loadSession]);
  return status;
}

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const t = useT();
  const [pending, setPending] = useState(false);
  const location = useLocation() as { state?: { from?: string } };

  if (status === "authenticated") {
    return <Navigate to={location.state?.from ?? afterSignIn()} replace />;
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 20, textAlign: "center" }}>{t("auth.signIn.title")}</h1>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", textAlign: "center" }}>
        {t("auth.signIn.body")}
      </p>

      {error && (
        <Alert tone="danger" title={t("auth.signIn.errorTitle")}>
          {error}
        </Alert>
      )}

      {canSignIn ? (
        <Button
          variant="primary"
          size="block"
          disabled={pending || status === "unknown"}
          onClick={() => {
            setPending(true);
            void login();
          }}
        >
          <LogIn size={16} aria-hidden />
          {pending ? t("auth.signIn.redirecting") : t("auth.signIn.button")}
        </Button>
      ) : (
        <Alert tone="warning" title={t("auth.signIn.notConfigured")}>
          {t("auth.signIn.notConfiguredBodyA")} <code>VITE_BLOCKS_OIDC_CLIENT_ID</code>
          {t("auth.signIn.notConfiguredBodyB")} <code>node scripts/02-oidc-client.mjs</code>{" "}
          {t("auth.signIn.notConfiguredBodyC")}
        </Alert>
      )}

      {/* Not an alternative way in — sign-in is SSO. This is for the case where the identity
          provider rejects a password the user no longer remembers setting. */}
      <p style={{ fontSize: 13, textAlign: "center", margin: 0 }}>
        <Link to="/forgot-password">{t("auth.signIn.forgot")}</Link>
      </p>
    </AuthShell>
  );
}

/**
 * OIDC callback. IAM redirects here with ?code&state.
 *
 * Runs exactly once: React 19 StrictMode double-invokes effects in development and the
 * authorization code is single-use, so a second exchange fails and would report a working
 * sign-in as broken.
 */
export function CallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const completeLogin = useAuthStore((s) => s.completeLogin);
  const t = useT();
  const [error, setError] = useState<unknown>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get("code");
    const state = params.get("state") ?? "";
    const denied = params.get("error");

    if (denied) {
      setError(new Error(params.get("error_description") || denied));
      return;
    }
    if (!code) {
      setError(new Error(t("auth.callback.noCode")));
      return;
    }
    completeLogin(code, state)
      .then(() => navigate(afterSignIn(), { replace: true }))
      .catch(setError);
  }, [params, completeLogin, navigate, t]);

  if (error) {
    const detail = error instanceof SessionNotEstablishedError ? error.callbackDetail : null;
    return (
      <AuthShell>
        <Alert tone="danger" title={t("auth.callback.failed")}>
          {(error as Error).message}
          {detail && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-subtle)" }}>{detail}</div>
          )}
        </Alert>
        <Button size="block" style={{ marginTop: 16 }} onClick={() => navigate("/login")}>
          {t("auth.callback.back")}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Loading label={t("auth.callback.working")} />
    </AuthShell>
  );
}

/** Signed in, any role. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const t = useT();
  const location = useLocation();

  if (status === "unknown") {
    return (
      <AuthShell>
        <Loading label={t("auth.session.checking")} />
      </AuthShell>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Signed in AND holding one of the listed roles.
 *
 * The refusal names the roles that would grant access and the roles the account actually
 * holds. "You do not have access to this area" on its own sends the reader to ask someone
 * who then has to go and look it up.
 */
export function RequireRole({
  any,
  children,
}: {
  any: RoleSlug[];
  children: React.ReactNode;
}) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const t = useT();
  const location = useLocation();

  if (status === "unknown") {
    return (
      <AuthShell>
        <Loading label={t("auth.session.checking")} />
      </AuthShell>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!hasRole(user, ...any)) {
    const held = rolesOf(user);
    /*
     * Role names follow the UI language (`role.*` keys); the fallbacks stay for a slug
     * the dictionary has never met. The list joiners are keys too — a German sentence
     * needs "oder"/"und", and neither can be sniffed from the joined result.
     */
    const roleLabel = (r: string) => t(`role.${r}` as DictKey) || ROLE_LABELS[r] || r;
    // ["A"] => "A"; ["A","B"] => "A or B"; ["A","B","C"] => "A, B or C".
    const joinRoles = (rs: string[], last: string) => {
      const labels = rs.map(roleLabel);
      if (labels.length < 2) return labels.join("");
      return `${labels.slice(0, -1).join(", ")} ${last} ${labels[labels.length - 1]}`;
    };
    return (
      <AuthShell>
        <Alert tone="warning" title={t("auth.role.deniedTitle")}>
          {t("auth.role.needs", { roles: joinRoles(any, t("common.or")) })}
          {held.length
            ? t("auth.role.holds", { roles: joinRoles(held, t("common.and")) })
            : t("auth.role.holdsNone")}
        </Alert>
        <Button
          size="block"
          style={{ marginTop: 16 }}
          onClick={() => window.location.assign(afterSignIn())}
        >
          {t("auth.role.startPage")}
        </Button>
      </AuthShell>
    );
  }
  return <>{children}</>;
}

/** Everyone who works inside the factory. Used for the internal shell; a Buyer is excluded. */
export function RequireInternal({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole
      any={[
        ROLES.admin,
        ROLES.gm,
        ROLES.merchandiser,
        ROLES.supervisor,
        ROLES.qa,
      ]}
    >
      {children}
    </RequireRole>
  );
}
