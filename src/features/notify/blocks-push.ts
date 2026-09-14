/**
 * Push side effects: Mail and Notifier, straight from the browser session.
 *
 * Both are notice, not record: the approval of record lives in the
 * ApprovalRegister, the issue trail in IssueEvent. A mail that fails to send
 * must never roll back a decision that is already stamped, so every helper
 * here resolves (with `ok: false`) rather than throwing, and the callers
 * treat the result as a UI note, not a gate.
 */
import { env } from "@/lib/env";
import { getAccessToken } from "@/lib/auth-token";

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = getAccessToken();
    const res = await fetch(`${env.apiUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-blocks-key": env.projectKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { isSuccess?: boolean; errors?: Record<string, string> }
      | null;
    if (!res.ok || data?.isSuccess === false) {
      const first = data?.errors ? Object.values(data.errors)[0] : undefined;
      return { ok: false, error: first ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/* ------------------------------------------------------------------ mail */

export interface SampleDecisionMail {
  to: string;
  buyerName: string;
  styleCode: string;
  sampleLabel: string;
  decision: "Approved" | "Rejected";
  decidedBy: string;
  decidedAt: string;
  openIssues: number;
  note?: string;
}

/**
 * The buyer-facing decision notice. Purpose maps to the
 * GarmentLineSampleDecision template saved by scripts/05-mail-template.mjs;
 * placeholders are the template's PascalCase tokens.
 */
export function sendSampleDecisionMail(m: SampleDecisionMail) {
  const ctx = {
    BuyerName: m.buyerName,
    StyleCode: m.styleCode,
    SampleLabel: m.sampleLabel,
    Decision: m.decision,
    DecidedBy: m.decidedBy,
    DecidedAt: m.decidedAt,
    OpenIssues: String(m.openIssues),
    NoteBlock: m.note
      ? `<p style="margin:12px 0 0;font-size:13px;"><strong>Note:</strong> ${escapeHtml(m.note)}</p>`
      : "",
  };
  return post("/logic/v4/Mail/SendToAny", {
    to: [m.to],
    purpose: "GarmentLineSampleDecision",
    language: "en-US",
    subjectDataContext: ctx,
    bodyDataContext: ctx,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/* -------------------------------------------------------------- notifier */

/**
 * In-app notification to a set of roles (Slugs like "factory-manager").
 *
 * denormalizedPayload is the SignalR payload the Notifier inbox reads; the
 * title/body convention matches the notification bell's rendering.
 */
export function notifyRoles(roles: string[], title: string, message: string) {
  return post("/logic/v4/Notifier/Notify", {
    roles,
    saveDenormalizedPayloadAsAnObject: true,
    denormalizedPayload: JSON.stringify({ title, message, at: new Date().toISOString() }),
  });
}
