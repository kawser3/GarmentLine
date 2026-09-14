/**
 * Row selection for the list tables — the "tick some rows, then act on them" half of bulk work.
 *
 *   const f = useRowFilter(rows, {...});
 *   const sel = useRowSelection(f.rows);
 *   ...
 *   <thead><tr><SelectAllHeader selection={sel} /> …
 *   <tbody>{f.rows.map((r) => <tr><SelectCell selection={sel} row={r} /> … )}
 *
 * SELECTION IS ALWAYS INTERSECTED WITH WHAT IS ON SCREEN. `ids` may hold rows the current
 * filter hides, but `rows`, `count` and every action derive from the intersection, so a bulk
 * action can never touch a row the user cannot see. That is the property that makes this safe
 * to combine with filtering: narrow the filter and the pending set shrinks to match; widen it
 * again and the earlier ticks come back rather than being silently discarded.
 *
 * The ids are deliberately NOT pruned in an effect. Pruning would make "filter, glance, unfilter"
 * quietly destroy a selection, and it would need a render pass to do it — the derived
 * intersection gives the same safety with neither cost.
 *
 * The rules themselves live in `lib/selection.ts` as pure functions, and are covered by
 * `npm run test:selection`. This file is the React binding and the two checkbox cells.
 */

import { useMemo, useRef, useState } from "react";
import {
  isAllSelected,
  selectedVisible,
  toggleAllSelection,
  toggleSelection,
} from "@/lib/selection";

export interface RowSelection<Row> {
  /** Every ticked id, including rows the current filter hides. Prefer `rows`. */
  ids: ReadonlySet<string>;
  /** The ticked rows that are ALSO currently visible, in visible order. Act on these. */
  rows: Row[];
  /** `rows.length` — what the UI reports and what the actions operate on. */
  count: number;
  isSelected: (id: string) => boolean;
  /** Ticks or unticks one row. With `shiftKey`, extends from the last row touched. */
  toggle: (id: string, shiftKey?: boolean) => void;
  /** Ticks every visible row, or unticks them all when they are already ticked. */
  toggleAll: () => void;
  /** True when every visible row is ticked (and there is at least one). */
  allSelected: boolean;
  /** True when some — but not all — visible rows are ticked. Drives the indeterminate box. */
  partiallySelected: boolean;
  clear: () => void;
}

export function useRowSelection<Row extends { ItemId: string }>(
  visibleRows: Row[],
): RowSelection<Row> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Index of the last row toggled, for shift-click ranges. Not state — it drives no render. */
  const anchor = useRef<number | null>(null);

  const rows = useMemo(() => selectedVisible(visibleRows, ids), [visibleRows, ids]);
  const count = rows.length;
  const allSelected = isAllSelected(visibleRows, ids);

  function toggle(id: string, shiftKey = false) {
    const res = toggleSelection(ids, visibleRows, id, { shiftKey, anchor: anchor.current });
    anchor.current = res.anchor;
    setIds(res.ids);
  }

  function toggleAll() {
    anchor.current = null;
    setIds(toggleAllSelection(ids, visibleRows));
  }

  function clear() {
    anchor.current = null;
    setIds(new Set());
  }

  return {
    ids,
    rows,
    count,
    isSelected: (id) => ids.has(id),
    toggle,
    toggleAll,
    allSelected,
    partiallySelected: count > 0 && !allSelected,
    clear,
  };
}

/* ------------------------------------------------------------------- cells */

/**
 * The header checkbox. Renders its own `<th>` so a table only has to drop it in first
 * position — the column's width and alignment come from `.select-col` in CSS.
 */
export function SelectAllHeader<Row>({ selection }: { selection: RowSelection<Row> }) {
  const s = selection;
  return (
    <th className="select-col">
      <input
        type="checkbox"
        className="row-check"
        checked={s.allSelected}
        /*
         * The indeterminate dash is a DOM property, not an attribute, so React cannot set it
         * from JSX — a ref callback is the only way. Without it a partial selection looks
         * identical to an empty one, and "select all" becomes a coin toss.
         */
        ref={(el) => {
          if (el) el.indeterminate = s.partiallySelected;
        }}
        onChange={s.toggleAll}
        aria-label={s.allSelected ? "Clear selection" : "Select all rows shown"}
        title={s.allSelected ? "Clear selection" : "Select all rows shown"}
      />
    </th>
  );
}

/** One row's checkbox. Shift-click extends from the last row touched. */
export function SelectCell<Row extends { ItemId: string }>({
  selection,
  row,
  label,
}: {
  selection: RowSelection<Row>;
  row: Row;
  /** Describes the row for screen readers, e.g. the project name. */
  label?: string;
}) {
  const checked = selection.isSelected(row.ItemId);
  return (
    <td className="select-col">
      <input
        type="checkbox"
        className="row-check"
        checked={checked}
        /*
         * onClick carries shiftKey; onChange does not — so the range case is handled here.
         * preventDefault cancels the checkbox's activation behaviour, which also cancels the
         * change event, so the plain handler below does not then fire a second toggle.
         */
        onClick={(e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          selection.toggle(row.ItemId, true);
        }}
        onChange={() => selection.toggle(row.ItemId)}
        aria-label={label ? `Select ${label}` : "Select row"}
      />
    </td>
  );
}
