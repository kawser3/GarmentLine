import { useLocation } from "react-router-dom";

import { cx } from "@/lib/utils";

/**
 * The SELISE Blocks Incident Management mark.
 *
 * Two real images, NOT a CSS mask. The artwork carries three brand colours —
 * orange-red #FB5202, blue #0081FD, green #0CC135 — and the three lines are the
 * identity. A luminance-to-alpha mask over `currentColor`, which is what the
 * calculator this shell came from used, would flatten all three into one flat
 * tint. `scripts/make-logo.mjs` therefore cuts black-to-transparent assets with
 * the RGB untouched.
 *
 * The cost is that the mark no longer follows the theme, and it does not need
 * to: a saturated three-colour image reads on the dark ground and on paper
 * alike, which is also why the report letterhead uses the same artwork.
 *
 * The glyph is square and radially composed, so its rotation has no seam — the
 * last frame and the first are the same picture.
 */

/** Read off the cropped output by make-logo.mjs; see generated/logo/logo.json. */
const WORDMARK_RATIO = 1.6171;

export function Logo({
  height = 30,
  className,
  spin = "none",
  wordmark = true,
  title = "Blocks Incident Management",
}: {
  height?: number;
  className?: string;
  /** `orbit` turns forever; `once` turns a single revolution on mount. */
  spin?: "none" | "once" | "orbit";
  wordmark?: boolean;
  title?: string;
}) {
  return (
    /* The height is set HERE, not on the images: `height: 100%` on a child
       resolves against nothing when the parent is auto, and both images then
       render at their natural size — 549px and 870px. */
    <span
      className={cx("logo", className)}
      style={{ height }}
      role="img"
      aria-label={title}
      title={title}
    >
      {/*
        Width and height are both given, so the box is reserved before the image
        loads — otherwise the whole row shifts on a cold visit.
      */}
      <img
        className={cx("logo-glyph", spin !== "none" && `spin-${spin}`)}
        src="/logo-glyph.png"
        alt=""
        width={height}
        height={height}
        aria-hidden
      />
      {wordmark && (
        <img
          className="logo-wordmark"
          src="/logo-wordmark.png"
          alt=""
          width={Math.round(height * WORDMARK_RATIO)}
          height={height}
          aria-hidden
        />
      )}
    </span>
  );
}

/**
 * The mark in the chrome: a single turn, then still.
 *
 * A mark rotating forever in the chrome of a tool people watch during an outage
 * competes with the only movement that should hold attention, which is an
 * incident changing state. So the header turns once — on load, and again on
 * every route change, which re-triggers the same revolution; the login screen
 * and the preloader are where the continuous orbit lives.
 *
 * `key={pathname}` is what re-triggers it — a CSS animation cannot be restarted
 * by toggling a class, because the class lands in the same frame the previous
 * animation is still finishing in. Remounting sidesteps that, and React does it
 * for free when the key changes.
 */
export function AnimatedLogo({ className, ...rest }: Parameters<typeof Logo>[0]) {
  const { pathname } = useLocation();
  return (
    <Logo
      key={pathname}
      className={className}
      spin="once"
      {...rest}
    />
  );
}
