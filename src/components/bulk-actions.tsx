/**
 * The bulk action bar — appears only once rows are ticked, and acts on exactly those rows.
 *
 *   <BulkActionBar
 *     selection={sel}
 *     entity="recurring charge"
 *     onDone={invalidate}
 *     actions={[
 *       { key: "activate", label: "Activate", verb: "activate",
 *         applies: (r) => r.IsActive === false, run: (r) => updateOne(r.ItemId, {IsActive:true}) },
 *       …
 *     ]}
 *   />
 *
 * Why a bar rather than buttons in the toolbar: a destructive control that is always present
 * has to describe its own scope ("Delete 107 shown"), and a label is a weak place to carry a
 * safety-critical number. Here the scope is whatever is ticked, the user ticked it, and the bar
 * only exists while there is something to act on — so the mode is visible rather than inferred.
 *
 * Three properties every action gets for free:
 *
 *  1. NO-OPS ARE SKIPPED, NOT FAILED. `applies` filters the ticked set, and the confirmation
 *     says how many were dropped. Activating 24 rows of which 17 are already active writes 7
 *     records and says so, instead of 24 pointless round trips.
 *  2. SEQUENTIAL EXECUTION. A bulk run is the worst place to saturate the gateway — a 429
 *     partway through leaves the set half-changed, and the retry in `gql` is per-request.
 *  3. PARTIAL FAILURE IS REPORTED AS FAILURE. The busy modal's error path is reached by
 *     throwing, so "112 changed, 19 failed" cannot be mistaken for success.
 *
 * Deliberately NOT translated (§08): the bar composes English sentences from moving parts —
 * plural morphology ("1 role" / "3 roles"), a gerund built by stripping a verb's trailing "e"
 * ("remov…ing") — and keying that means per-action keys for every caller, a refactor rather
 * than a sweep. Master-data tables are an internal-admin surface; when a customer-facing
 * surface adopts this bar, the labels and sentences become dictionary keys first.
 */

import { type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";
import { useBusy } from "./busy";
import { useConfirm } from "./confirm";
import { type RowSelection } from "./row-selection";

export interface BulkAction<Row> {
  key: string;
  /** Button text, e.g. "Deactivate". */
  label: string;
  icon?: ReactNode;
  /** Lowercase verb used in the confirmation and progress text, e.g. "deactivate". */
  verb: string;
  /** Past participle for the result message, e.g. "deactivated". Defaults to `verb + "d"`. */
  verbPast?: string;
  tone?: "danger";
  /**
   * Rows this action would actually change. Ticked rows outside it are skipped and reported,
   * never sent. Omit when the action applies to everything.
   */
  applies?: (row: Row) => boolean;
  /** Extra line in the confirmation — consequences the count does not convey. */
  note?: string;
  /** Performs the action for one row. Should throw on failure. */
  run: (row: Row) => Promise<unknown>;
}

export function BulkActionBar<Row extends { ItemId: string }>({
  selection,
  actions,
  entity,
  onDone,
}: {
  selection: RowSelection<Row>;
  actions: BulkAction<Row>[];
  /** Singular noun, e.g. "billing line". */
  entity: string;
  /** Runs once after a pass — usually a single cache invalidation. */
  onDone?: () => Promise<unknown> | void;
}) {
  const confirm = useConfirm();
  const busy = useBusy();
  const s = selection;

  // The bar is the selection's only affordance, so it must not render when nothing is ticked.
  if (s.count === 0) return null;

  const noun = (n: number) => `${n} ${n === 1 ? entity : `${entity}s`}`;

  async function start(action: BulkAction<Row>) {
    const targets = action.applies ? s.rows.filter(action.applies) : s.rows;
    const skipped = s.count - targets.length;
    if (targets.length === 0) return;

    const past = action.verbPast ?? `${action.verb}d`;
    const ok = await confirm({
      title: `${action.label} ${noun(targets.length)}?`,
      bullets: [
        skipped > 0
          ? `${targets.length} of ${s.count} selected will be ${past} — ${skipped} would not change and will be skipped`
          : `${noun(targets.length)} will be ${past}`,
        ...(action.note ? [action.note] : []),
        ...(action.tone === "danger" ? ["This cannot be undone"] : []),
      ],
      confirmLabel: `${action.label} ${targets.length}`,
      cancelLabel: "Cancel",
      tone: action.tone,
    });
    if (!ok) return;

    await busy.run(
      `${action.label.replace(/e$/, "")}ing ${noun(targets.length)}…`,
      async (report) => {
        let failed = 0;
        const errors: string[] = [];
        for (const [i, row] of targets.entries()) {
          try {
            await action.run(row);
          } catch (e) {
            failed += 1;
            if (errors.length < 5) errors.push((e as Error).message);
          }
          report(i + 1, targets.length);
        }
        // One invalidation for the whole run, after the writes rather than between them.
        await onDone?.();
        if (failed > 0) {
          throw new Error(
            `${targets.length - failed} ${past}, ${failed} failed. ${errors.join("; ")}`.trim(),
          );
        }
      },
    );
    /*
     * Cleared only on success. After a partial failure the ticks stay, so the obvious retry
     * acts on the same set — and the rows that succeeded are skipped by `applies` on the
     * second pass anyway.
     */
    s.clear();
  }

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-count">
        <strong>{s.count}</strong> selected
      </span>

      <div className="bulk-buttons">
        {actions.map((a) => {
          const targets = a.applies ? s.rows.filter(a.applies).length : s.count;
          return (
            <Button
              key={a.key}
              size="sm"
              variant={a.tone === "danger" ? "danger" : "default"}
              disabled={targets === 0}
              title={
                targets === 0
                  ? `None of the selected rows would change`
                  : targets < s.count
                    ? `${a.label} ${targets} of ${s.count} selected — the rest would not change`
                    : `${a.label} the ${noun(targets)} selected`
              }
              onClick={() => void start(a)}
            >
              {a.icon}
              {a.label}
              {/* Only shown when it differs from the selected count, so it reads as a warning. */}
              {targets > 0 && targets < s.count && <span className="bulk-sub">{targets}</span>}
            </Button>
          );
        })}
      </div>

      <button type="button" className="bulk-clear" onClick={s.clear}>
        <X size={13} aria-hidden />
        Clear selection
      </button>
    </div>
  );
}
