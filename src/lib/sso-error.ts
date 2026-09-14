/**
 * Reading a failed SSO callback.
 *
 * Pure and dependency-free on purpose: deciding whether to CREATE AN ACCOUNT from an error
 * message is the kind of judgement that deserves tests, and tests it can only have if the
 * module imports no `window`, no `import.meta.env` and no fetch layer.
 *
 * The distinction being drawn is narrow. `/iam/v4/auth/social/callback` answers 401 for several
 * unrelated reasons — a spent authorization code, a mismatched state, a disabled provider — and
 * exactly one of them means "Microsoft vouched for this person, but the project has never seen
 * them". Only that one should onboard anybody.
 */

/**
 * Does this failure mean the person is authenticated but unregistered?
 *
 * Matched on the sentence rather than the status code, because every other cause is a 401 too.
 * Treating the status as the signal would sign someone up whenever a code was replayed.
 */
export function isUnknownSsoUser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /does not exist|not\s+found|no\s+such\s+user/i.test(message);
}

/**
 * Did signup refuse because the address is already registered?
 *
 * Blocks returns `{"errors": {"already_signed_up": "<email> is already registered"}}`, which
 * the fetch layer flattens into the message. Both the key and the sentence are matched, since
 * only the flattened text survives.
 *
 * Reaching this is informative rather than merely a duplicate: it is only ever consulted after
 * the callback said the user does NOT exist. The two together mean the account is real but
 * cannot be signed in to — which is what "pending activation" looks like from outside.
 */
export function isAlreadyRegistered(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /already_signed_up|already\s+registered|already\s+exists/i.test(message);
}

/**
 * Does the failure itself say the account is not yet usable?
 *
 * Checked before the signup round trip, for deployments where the callback is explicit about
 * it. When it is not, `isAlreadyRegistered` on the signup attempt reaches the same conclusion
 * by a different route.
 */
export function isPendingActivation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /pending\s*activation|not\s*(yet\s*)?activ(e|ated)|inactive|awaiting\s*activation/i.test(
    message,
  );
}

/**
 * The address Blocks names in that error — the identity Microsoft just proved.
 *
 * Deliberately returns null rather than a guess when there is no address in the message: the
 * caller signs somebody up with whatever comes back, so inventing one would create an account
 * for an address nobody authenticated as.
 */
export function emailFromError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const hit = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return hit ? hit[0] : null;
}
