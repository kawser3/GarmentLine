/**
 * The three password screens, on top of the IAM service's own endpoints.
 *
 *   /forgot-password   POST /iam/v4/auth/recover          no session — anyone may ask
 *   /resetpassword     POST /iam/v4/auth/reset-password   no session — the emailed code is the credential
 *   /account/password  POST /iam/v4/auth/change-password  signed in — needs the old password
 *
 * The frontend route is /resetpassword (no hyphen) — it has to match the link IAM's own
 * password-reset email actually sends, which is server-generated and not something this app
 * controls. The API path directly below it keeps its hyphen; that one really is
 * "reset-password", confirmed against the live swagger. Only the frontend route lost the hyphen.
 *
 * Endpoint names and payloads were taken from the IAM service's published swagger
 * (`/iam/v4/swagger/v1/swagger.json`), not guessed: the account skill documents activate and
 * logout but not these. Note the served paths drop the swagger's `/api` prefix, the same way
 * `/auth/activate` does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE THING TO UNDERSTAND HERE: `recover` NEVER REPORTS WHETHER THE ACCOUNT EXISTS.
 *
 * Its swagger description states the invariant outright — it always returns 200 with
 * IsSuccess = true for any well-formed request, whether or not the address belongs to an account,
 * and for unknown or inactive users it silently sends an activation email instead of a reset
 * email. This is deliberate anti-enumeration: an endpoint that answered honestly would let anyone
 * test which staff addresses have accounts here.
 *
 * So the confirmation screen must be worded neutrally. "We've sent you a reset link" would be a
 * claim this app cannot support and would leak the very thing the server refuses to — a user who
 * mistypes their address deserves "check your inbox, and if nothing arrives the address may not
 * be registered", not a false promise.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Mail } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthHead, AuthShell } from "@/components/auth-shell";
import { PageHead } from "@/components/layout";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { api, envelopeError } from "@/lib/blocks-api";
import { env } from "@/lib/env";
import {
  MIN_PASSWORD,
  passwordStrength,
  validateNewPassword,
} from "@/lib/password";

/* ------------------------------------------------------------------ plumbing */

/**
 * POST to an IAM auth endpoint with no session at all.
 *
 * Does not use the shared `api()` helper for the same reason activation does not: that helper
 * attaches the bearer token, and sending one here would imply these calls are authenticated when
 * the emailed code (or nothing at all) is the credential. `x-blocks-key` is still required.
 */
interface AuthEnvelope {
  isSuccess?: boolean;
  message?: string;
  /** Field-keyed messages — this is where IAM actually puts the reason. */
  errors?: Record<string, string>;
}

// `envelopeError` itself now lives in blocks-api.ts — the change-password call below goes
// through the shared `api()` helper, which needed the exact same envelope-reading logic (it was
// falling through to a bare "403 Forbidden" with the real reason thrown away). One reader, used
// by both the authenticated and the anonymous calls in this file.

async function postAnonymous(path: string, payload: unknown) {
  const res = await fetch(`${env.apiUrl}/iam/v4/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-blocks-key": env.projectKey },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(envelopeError(body, res.statusText || `HTTP ${res.status}`));
  }

  /*
   * A 200 does not mean success. These endpoints report failure inside the envelope, so a request
   * refused on validation can arrive as 200 with isSuccess: false — treating the status alone as
   * the answer would show a success screen while nothing had changed.
   */
  const b = body as AuthEnvelope | undefined;
  if (b && b.isSuccess === false) {
    throw new Error(envelopeError(body, "The request was not accepted."));
  }
  return body;
}

/* ----------------------------------------------------------- forgot password */

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const m = useMutation({
    mutationFn: () => postAnonymous("auth/recover", { email: email.trim(), captchaCode: "" }),
    onSuccess: () => setSent(true),
  });

  if (sent) {
    return (
      <AuthShell>
        <AuthHead title="Check your email" />
        {/*
          Worded to match what the server actually guarantees. It does not tell us whether the
          address is registered, so this must not either — see the note at the top of the file.
        */}
        <Alert tone="success" title={`If ${email.trim()} has an account, a link is on its way`}>
          Open the link in that email to choose a new password. It is valid for a limited time and
          can only be used once. Nothing arrived after a few minutes? The address may not be
          registered, or the message may be in your spam folder.
        </Alert>
        <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
          <Link to="/login">
            <Button variant="primary" size="block">
              Back to sign in
            </Button>
          </Link>
          <Button
            size="block"
            onClick={() => {
              setSent(false);
              m.reset();
            }}
          >
            Use a different address
          </Button>
        </div>
      </AuthShell>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    // Only a shape check. Whether the address exists is deliberately not knowable from here.
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setLocalError("Enter the email address you sign in with.");
      return;
    }
    setLocalError(null);
    m.mutate();
  }

  return (
    <AuthShell>
      <AuthHead title="Forgot your password?">
        Enter your email address and we will send you a link to set a new one.
      </AuthHead>

      {/*
        noValidate so the app is the single voice on validation. With the browser's own
        `type=email` check active, "not-an-email" produced a native bubble while "a@b" produced an
        in-page Alert — two different error styles for the same mistake, and the bubble is easy to
        miss. The input keeps type=email for the mobile keyboard; the check below is the gate.
      */}
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: 14 }}>
        <Field label="Email address" required>
          <Input
            type="email"
            value={email}
            autoComplete="email"
            autoFocus
            placeholder="you@selise.ch"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        {localError && <Alert tone="danger">{localError}</Alert>}
        {m.isError && <Alert tone="danger">{(m.error as Error).message}</Alert>}

        <Button type="submit" variant="primary" size="block" disabled={m.isPending}>
          <Mail size={16} aria-hidden />
          {m.isPending ? "Sending…" : "Send reset link"}
        </Button>
        <Link to="/login" style={{ fontSize: 13, textAlign: "center" }}>
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}

/* ------------------------------------------------------------ reset password */

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  /*
   * The email link's token. `code` matches the reset-password payload and the activation link's
   * parameter; `token` is accepted too because the mail template is configured server-side and
   * this app cannot see which name it uses. Reading both costs nothing and avoids a dead link.
   */
  const code = useMemo(() => params.get("code") ?? params.get("token") ?? "", [params]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: () =>
      postAnonymous("auth/reset-password", {
        code,
        password,
        captchaCode: "",
        /*
         * Signs every other device out. After a reset the honest assumption is that the old
         * password may be in someone else's hands — leaving existing sessions alive would let
         * whoever prompted the reset keep the access it was meant to revoke.
         */
        logoutFromAllDevices: true,
      }),
    onSuccess: () => {
      setDone(true);
      window.setTimeout(() => navigate("/login", { replace: true }), 2200);
    },
  });

  if (!code) {
    return (
      <AuthShell>
        <AuthHead title="Reset link incomplete" />
        <Alert tone="danger" title="Missing reset token">
          Open the link from your reset email directly — the token cannot be typed by hand.
        </Alert>
        <Link to="/forgot-password">
          <Button size="block" style={{ marginTop: 16 }}>
            Request a new link
          </Button>
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <AuthHead title="Password changed" />
        <Alert tone="success" title="Your new password is set">
          Other devices have been signed out. Sign in again with your new password. Redirecting…
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
    const err = validateNewPassword({ password, confirm });
    setLocalError(err);
    if (err) return;
    m.mutate();
  }

  return (
    <AuthShell>
      <AuthHead title="Choose a new password">
        This link works once. After saving you will sign in again.
      </AuthHead>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
        />

        {localError && <Alert tone="danger">{localError}</Alert>}
        {m.isError && (
          <Alert tone="danger" title="The reset was not accepted">
            {(m.error as Error).message}
          </Alert>
        )}

        <Button type="submit" variant="primary" size="block" disabled={m.isPending}>
          <KeyRound size={16} aria-hidden />
          {m.isPending ? "Saving…" : "Set new password"}
        </Button>
        <Link to="/forgot-password" style={{ fontSize: 13, textAlign: "center" }}>
          Request a new link
        </Link>
      </form>
    </AuthShell>
  );
}

/* ----------------------------------------------------------- change password */

/**
 * The signed-in version. Unlike the two above, this one DOES authenticate — it goes through the
 * shared `api()` helper so the bearer token is attached and a 401 triggers the refresh-and-retry.
 */
export function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const body = await api<AuthEnvelope>("/iam/v4/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ oldPassword: current, newPassword: password }),
      });
      // Same envelope caveat as the anonymous calls: 200 does not imply the change was made.
      if (body && body.isSuccess === false) {
        throw new Error(envelopeError(body, "The change was not accepted."));
      }
      return body;
    },
    onSuccess: () => {
      setDone(true);
      setCurrent("");
      setPassword("");
      setConfirm("");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) {
      setLocalError("Enter your current password.");
      return;
    }
    const err = validateNewPassword({ password, confirm, current });
    setLocalError(err);
    if (err) return;
    setLocalError(null);
    m.mutate();
  }

  return (
    <>
      <PageHead title="Change password" description="Update the password for your account" />
      <div className="page-body">
        <Card title="Change password" sub="You will stay signed in on this device">
          <form onSubmit={submit} style={{ display: "grid", gap: 14, maxWidth: 420 }}>
            <Field label="Current password" required>
              <Input
                type="password"
                value={current}
                autoComplete="current-password"
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>

            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
            />

            {done && !m.isPending && (
              <Alert tone="success" title="Password updated">
                Use the new password the next time you sign in.
              </Alert>
            )}
            {localError && <Alert tone="danger">{localError}</Alert>}
            {m.isError && (
              <Alert tone="danger" title="The change was not accepted">
                {(m.error as Error).message} If your current password is correct, the new one may
                not meet the password policy.
              </Alert>
            )}

            <div>
              <Button type="submit" variant="primary" disabled={m.isPending}>
                <KeyRound size={15} aria-hidden />
                {m.isPending ? "Saving…" : "Change password"}
              </Button>
            </div>
          </form>
        </Card>

        <div style={{ marginTop: 18 }}>
          <Alert tone="info" title="Forgotten it instead?">
            If you cannot supply your current password, sign out and use{" "}
            <Link to="/forgot-password">Forgot your password?</Link> on the sign-in screen. That
            route emails you a one-time link and signs your other devices out.
          </Alert>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- shared */

/** The new-password pair, identical on the reset and change forms. */
function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const strength = passwordStrength(password);
  return (
    <>
      <Field
        label="New password"
        required
        hint={
          strength
            ? `At least ${MIN_PASSWORD} characters · strength: ${strength}`
            : `At least ${MIN_PASSWORD} characters`
        }
      >
        <Input
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => onPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password" required>
        <Input
          type="password"
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => onConfirm(e.target.value)}
        />
      </Field>
    </>
  );
}
