/**
 * The one place the app decides whether a chosen password is acceptable.
 *
 * Shared by activation, reset-password and change-password so the three cannot disagree — a rule
 * enforced on one screen and not another means a user picks a password on the reset page that the
 * activation page would have rejected, with nothing to explain the difference.
 *
 * DELIBERATELY MODEST. The IAM service publishes no password policy (checked: the only
 * password-related schemas in its swagger are the two request bodies, and there is no policy
 * endpoint), so this cannot mirror the server's rules — it can only avoid contradicting them.
 * Client-side checks here are the ones that are certainly wrong to allow: too short, mistyped
 * confirmation, unchanged password. Anything stricter risks blocking a password the server would
 * have accepted, so the server stays the authority and its message is surfaced verbatim.
 */

/** Matches the minimum the activation page has always enforced. */
export const MIN_PASSWORD = 8;

export interface NewPasswordCheck {
  password: string;
  /** The "confirm password" box. Never sent to the API — it exists to catch a typo. */
  confirm: string;
  /**
   * The current password, on the change-password form only. Used to reject a no-op change, which
   * the server accepts happily but which is never what the user meant.
   */
  current?: string;
}

/**
 * Returns an error message to show, or null when the password may be submitted.
 *
 * Order matters: it reports the problem the user is most likely to be able to fix, so an empty
 * confirm box does not produce "the two passwords do not match" while they are still typing the
 * first one.
 */
export function validateNewPassword({
  password,
  confirm,
  current,
}: NewPasswordCheck): string | null {
  if (!password) return "Choose a password.";
  if (password.length < MIN_PASSWORD) {
    return `Your password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (current !== undefined && current !== "" && password === current) {
    return "The new password is the same as your current one.";
  }
  if (!confirm) return "Re-type the password to confirm it.";
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

/**
 * A rough strength read for the hint under the field. Advisory only — it never blocks submission,
 * because the server owns the policy and a client-side meter that refuses a valid password is
 * worse than no meter.
 */
export type PasswordStrength = "weak" | "fair" | "strong";

export function passwordStrength(password: string): PasswordStrength | null {
  if (password.length < MIN_PASSWORD) return null;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 14 && classes >= 3) return "strong";
  if (password.length >= 12 || classes >= 3) return "fair";
  return "weak";
}
