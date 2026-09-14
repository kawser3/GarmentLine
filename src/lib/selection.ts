/**
 * The pure reducer behind row selection. The React hook in `components/row-selection.tsx` is a
 * thin `useState` wrapper over these.
 *
 * Split out so the rules can be tested in the normal `npm test` harness without a DOM. They are
 * worth testing: this is the code that decides which records a bulk Delete is about to act on,
 * and the interesting cases (a selection that outlives a filter change, a shift-range that runs
 * backwards) are exactly the ones nobody exercises by hand.
 *
 * THE SAFETY PROPERTY, stated once: `ids` is a set of row ids with no knowledge of what is on
 * screen, and `selectedVisible` is the only way anything reads it. So a bulk action can only
 * ever touch rows that are both ticked AND currently visible. Ticks for filtered-out rows are
 * kept, not applied — narrowing a filter shrinks what an action can do, and widening it back
 * restores the earlier ticks instead of having silently discarded them.
 */

export interface HasItemId {
  ItemId: string;
}

/** The ticked rows that are also currently visible, in visible order. */
export function selectedVisible<Row extends HasItemId>(
  visible: Row[],
  ids: ReadonlySet<string>,
): Row[] {
  return visible.filter((r) => ids.has(r.ItemId));
}

/** True when every visible row is ticked. False for an empty table — there is nothing to select. */
export function isAllSelected<Row extends HasItemId>(
  visible: Row[],
  ids: ReadonlySet<string>,
): boolean {
  return visible.length > 0 && selectedVisible(visible, ids).length === visible.length;
}

export interface ToggleResult {
  ids: Set<string>;
  /** The new anchor index for a subsequent shift-click, or null when there isn't one. */
  anchor: number | null;
}

/**
 * Ticks or unticks one row.
 *
 * With `shiftKey` and a previous anchor, every row between the anchor and this one is set to
 * match what this row is becoming — so shift-clicking an unticked row selects the range, and
 * shift-clicking a ticked one clears it. That is the file-manager convention, and it matters
 * because the alternative to a working range is people reaching for "select all".
 */
export function toggleSelection<Row extends HasItemId>(
  ids: ReadonlySet<string>,
  visible: Row[],
  id: string,
  opts: { shiftKey?: boolean; anchor: number | null } = { anchor: null },
): ToggleResult {
  const index = visible.findIndex((r) => r.ItemId === id);
  const next = new Set(ids);

  if (opts.shiftKey && opts.anchor != null && index >= 0) {
    const [from, to] = [opts.anchor, index].sort((a, b) => a - b);
    const turningOn = !ids.has(id);
    for (let i = from; i <= to; i += 1) {
      const rowId = visible[i]?.ItemId;
      if (!rowId) continue;
      if (turningOn) next.add(rowId);
      else next.delete(rowId);
    }
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return { ids: next, anchor: index >= 0 ? index : opts.anchor };
}

/**
 * Ticks every visible row, or unticks them all when they are already ticked.
 *
 * Scoped to `visible` in both directions: it never ticks a row the filter hides, and clearing
 * never reaches outside the filter either.
 */
export function toggleAllSelection<Row extends HasItemId>(
  ids: ReadonlySet<string>,
  visible: Row[],
): Set<string> {
  const next = new Set(ids);
  const all = isAllSelected(visible, ids);
  for (const row of visible) {
    if (all) next.delete(row.ItemId);
    else next.add(row.ItemId);
  }
  return next;
}
