/**
 * Should the sticky summary be in its compact state?
 *
 * Pure, because this shipped a visible bug twice and "it looks fine now" is not a check.
 *
 * TWO THINGS MAKE IT FLICKER, AND BOTH NEED ANSWERING
 * ---------------------------------------------------
 * 1. SUB-PIXEL JITTER. A single comparison — "is the card's top at its CSS offset" — is crossed
 *    repeatedly within one gesture, because trackpads and fractional device pixel ratios put the
 *    top at 76.4, then 75.8, then 76.2. Answered by hysteresis: collapse when it arrives, expand
 *    only once it has travelled well clear.
 *
 * 2. THE DOCUMENT GETTING SHORTER. Collapsing removes the detail block — around 200px — from a
 *    page that is in flow. On a SHORT page that can take the document below the viewport, so the
 *    browser forces `scrollY` back toward 0, which un-sticks the card, which expands it, which
 *    restores the height. Scroll a little again and it repeats. This is why it flickered on a
 *    small scroll and settled once there was more content: a long page has slack, a short one
 *    does not. Answered by refusing to collapse at all unless the page has room to spare.
 *
 * Hysteresis alone does NOT fix (2) — the forced scroll can exceed any dead band — which is why
 * the first fix did not hold.
 */

/** How close to its offset the card must come before collapsing. */
export const COLLAPSE_AT = 2;

/** How far past its offset it must return before expanding again. Must exceed COLLAPSE_AT. */
export const EXPAND_AT = 48;

/**
 * Scrollable room the page must have before collapsing is allowed, in pixels.
 *
 * Comfortably more than the detail block's own height, so that removing it can never take the
 * document below the viewport and trigger a forced scroll.
 */
export const MIN_SCROLL_ROOM = 360;

export interface StickyInput {
  /** Current state, so the decision can be hysteretic. */
  wasStuck: boolean;
  /** The card's viewport-relative top. */
  top: number;
  /** The `top` its stylesheet gives it — read from computed style, never hardcoded. */
  offset: number;
  /** `scrollHeight - innerHeight`: how far the page can scroll at all. */
  scrollRoom: number;
}

export function nextStuckState({ wasStuck, top, offset, scrollRoom }: StickyInput): boolean {
  if (wasStuck) {
    // Already compact: hold it until the top is clearly clear of the line. Deliberately does
    // NOT re-check the room — the room is smaller *because* it is collapsed, and re-checking
    // would expand it immediately and start the loop this exists to prevent.
    return top <= offset + EXPAND_AT;
  }
  // Not yet compact: only collapse on a page with slack to absorb losing the detail block.
  if (scrollRoom < MIN_SCROLL_ROOM) return false;
  return top <= offset + COLLAPSE_AT;
}
