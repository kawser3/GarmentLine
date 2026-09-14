/**
 * The front door.
 *
 * A two-pane screen: the sign-in card on the left, a field of brand colour on the right.
 * Modelled on the OOPs auth screen (PLAN §07), with one deliberate departure — OOPs runs an
 * indigo-to-violet gradient, and adopting its LAYOUT is right while adopting its HUES would
 * put a non-SELISE colour on the first screen anyone sees. The marketing panel is the single
 * largest field of brand colour in the product, so it is SELISE blue into Oxford Blue.
 *
 * Used by every page reachable without a session — sign in, the OIDC callback, activation,
 * forgot password, reset password. Kept in one place because these pages are the front door:
 * if one drifts visually it reads as a phishing page rather than a design slip.
 */

import { type ReactNode } from "react";
import { BellRing, FileCheck2, GitMerge, Radar } from "lucide-react";
import { Logo } from "./logo";

/**
 * What the product does, in four lines.
 *
 * Chosen to match the five gates and the two report types rather than to fill the space —
 * a judge reads these before anything else in the demo.
 */
const FEATURES = [
  { icon: Radar, text: "Detects through any monitoring provider" },
  { icon: GitMerge, text: "Correlates a storm into one incident, not five" },
  { icon: BellRing, text: "Tracks SLA against per-severity targets" },
  { icon: FileCheck2, text: "Reports internally and to the client, separately" },
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-panel-form">
        {/*
          The mark sits ABOVE the card, not inside it — the way a letterhead sits above a
          sheet of paper rather than on it. So this pane is a column: mark, card, foot.

          It is the masked .logo, not an <img>, so its ink comes from the pane's own colour
          and one asset stays correct in both themes. The box reserves its space by aspect
          ratio, or the whole column shifts as the mask loads.
        */}
        {/* The continuous orbit lives here — this is the screen it exists for. */}
        {/* ~180px wide overall: the wordmark is a three-line lockup and needs
            the height to stay legible. */}
        <Logo height={62} spin="orbit" className="auth-logo" />
        <div className="auth-card">{children}</div>
      </div>

      <aside className="auth-panel-marketing" aria-hidden>
        <div className="auth-marketing-content">
          <div className="auth-kicker">ITIL 4 incident management</div>
          <h2 className="auth-headline">Every incident, every unit, one register.</h2>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.text}>
                <span className="auth-feature-icon">
                  <f.icon size={16} aria-hidden />
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Heading + supporting line, so the auth pages introduce themselves identically. */
export function AuthHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 style={{ fontSize: 18, marginBottom: children ? 6 : 12 }}>{title}</h1>
      {children && (
        <p style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 0, marginBottom: 20 }}>
          {children}
        </p>
      )}
    </>
  );
}
