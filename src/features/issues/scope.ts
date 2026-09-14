/**
 * Who may see which records.
 *
 * The brief is explicit: "A merchandiser sees the styles and buyers they handle; a
 * supervisor sees the lines they run; the GM sees everything including cost impact."
 *
 * Capability (stores/auth.ts) answers WHAT MAY I DO. This answers TO WHICH RECORDS.
 * Keeping them apart is what lets the GM read everything without widening any other role.
 *
 * This is the visible half. Row-level enforcement belongs in a Data Gateway access
 * policy comparing the owner field to the token subject; until that is in place a
 * determined signed-in user could still query another scope's rows directly.
 */
import { ROLES, rolesOf, type BlocksUser } from "@/stores/auth";
import type { Issue, Line, Style } from "@/features/data/garment-schemas";

/** The id the platform knows a user by, matched against MerchandiserId / SupervisorId. */
export function subjectOf(user: BlocksUser | null | undefined): string {
  return user?.itemId ?? "";
}

function holds(user: BlocksUser | null | undefined, role: string): boolean {
  return rolesOf(user).includes(role);
}

/** The GM, admin and QA read across the whole floor; QA inspects everything by trade. */
export function seesEverything(user: BlocksUser | null | undefined): boolean {
  return holds(user, ROLES.admin) || holds(user, ROLES.gm) || holds(user, ROLES.qa);
}

export function visibleStyles(user: BlocksUser | null | undefined, styles: Style[]): Style[] {
  if (seesEverything(user)) return styles;
  if (holds(user, ROLES.merchandiser)) {
    const me = subjectOf(user);
    return styles.filter((s) => s.MerchandiserId === me);
  }
  return styles;
}

export function visibleLines(user: BlocksUser | null | undefined, lines: Line[]): Line[] {
  if (seesEverything(user)) return lines;
  if (holds(user, ROLES.supervisor)) {
    const me = subjectOf(user);
    return lines.filter((l) => l.SupervisorId === me);
  }
  return lines;
}

/**
 * An issue is visible when either side of it is: the style you merchandise, or the line
 * you run. A supervisor must see a sampling issue routed to their line even though the
 * style belongs to someone else, which is why this is an OR and not an AND.
 */
export function visibleIssues(
  user: BlocksUser | null | undefined,
  issues: Issue[],
  styles: Style[],
  lines: Line[],
): Issue[] {
  if (seesEverything(user)) return issues;
  const styleIds = new Set(visibleStyles(user, styles).map((s) => s.ItemId));
  const lineIds = new Set(visibleLines(user, lines).map((l) => l.ItemId));
  return issues.filter((i) => styleIds.has(i.StyleId) || (i.LineId && lineIds.has(i.LineId)));
}
