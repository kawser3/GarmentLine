import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Field, Input } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { env } from "@/lib/env";
import { MIN_PASSWORD, validateNewPassword } from "@/lib/password";

interface ActivateInput {
  code: string; // invitation token from /activate?code=
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Activation is not part of SSO login. Only users created or invited through the Blocks portal
 * or IAM API arrive here, once, to set a password before their first sign-in.
 *
 * The invitation code IS the credential — this call carries no bearer token and no session
 * cookie, so it deliberately does not use the shared `api()` helper, which sends credentials
 * and would imply an existing session.
 */
async function activate(input: ActivateInput) {
  const res = await fetch(`${env.apiUrl}/iam/v4/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-blocks-key": env.projectKey },
    body: JSON.stringify({
      captchaCode: "",
      mailPurpose: "",
      preventPostEvent: false,
      ...input,
    }),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const b = body as { message?: string; errors?: Record<string, string> } | undefined;
    const detail =
      b?.message ??
      (b?.errors ? Object.values(b.errors).join("; ") : undefined) ??
      res.statusText;
    // 400/404 here almost always means the token was already used or has expired.
    throw new Error(
      res.status === 400 || res.status === 404
        ? `${detail} — this invitation link may already have been used, or it has expired.`
        : `Activation failed (${res.status}): ${detail}`,
    );
  }

  // The envelope reports failure with HTTP 200 in some cases, so check it too.
  const b = body as { isSuccess?: boolean; message?: string } | undefined;
  if (b && b.isSuccess === false) {
    throw new Error(b.message ?? "Activation was not accepted.");
  }
  return body;
}

export function ActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = useMemo(() => params.get("code") ?? "", [params]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: () => activate({ code, password, firstName, lastName }),
    onSuccess: () => {
      setDone(true);
      // Let the confirmation register before handing over to SSO.
      window.setTimeout(() => navigate("/login", { replace: true }), 1800);
    },
  });

  if (!code) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>Invitation link incomplete</h1>
        <Alert tone="danger" title="Missing activation token">
          Open the link from your invitation email directly — the token cannot be typed by hand.
        </Alert>
        <Link to="/login">
          <Button size="block" style={{ marginTop: 16 }}>
            Go to sign in
          </Button>
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>Account activated</h1>
        <Alert tone="success" title="Your password is set">
          You will sign in with SSO from now on. Redirecting…
        </Alert>
        <Link to="/login">
          <Button variant="primary" size="block" style={{ marginTop: 16 }}>
            Continue to sign in
          </Button>
        </Link>
      </AuthShell>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setLocalError("First and last name are required.");
      return;
    }
    // Confirm-password is UI-only; the shared rule is what decides, so activation, reset and
    // change cannot disagree about what an acceptable password is.
    const err = validateNewPassword({ password, confirm });
    setLocalError(err);
    if (err) return;
    m.mutate();
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>Activate your account</h1>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 0, marginBottom: 20 }}>
        Set your name and a password. This is a one-time step — afterwards you sign in with SSO.
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label="First name" required>
          <Input
            value={firstName}
            autoComplete="given-name"
            onChange={(e) => setFirstName(e.target.value)}
          />
        </Field>
        <Field label="Last name" required>
          <Input
            value={lastName}
            autoComplete="family-name"
            onChange={(e) => setLastName(e.target.value)}
          />
        </Field>
        <Field label="Password" required hint={`At least ${MIN_PASSWORD} characters`}>
          <Input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password" required>
          <Input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        {localError && <Alert tone="danger">{localError}</Alert>}
        {m.isError && <Alert tone="danger">{(m.error as Error).message}</Alert>}

        <Button type="submit" variant="primary" size="block" disabled={m.isPending}>
          {m.isPending ? "Activating…" : "Activate account"}
        </Button>
      </form>
    </AuthShell>
  );
}
