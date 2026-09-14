/**
 * The application's one search + filter toolbar.
 *
 * Every record-list page (billing, recurring, costs, quotations, the master-data tables)
 * composes this from a `useRowFilter` hook plus its filter definitions, and gets the same
 * layout, controls, spacing and responsive behaviour for free. The design is fixed here so
 * a page cannot drift — it only declares *what* is searchable and filterable, not *how* it
 * looks.
 *
 *   const f = useRowFilter(rows, { getText, filters, getFilterValue });
 *   <TableToolbar filter={f} filters={filters} />
 *   // and in the table Card's actions slot:
 *   <FilterCount filter={f} total={rows.length} />
 *
 * Layout (one row on desktop, wraps on narrower screens):
 *
 *   [ Search............ ] [ Primary ▼ ] [ Secondary ▼ ]    139 Records   Reset
 *
 * Search is first and the widest control. Filters keep their label visible. The record
 * count and a Reset button sit at the right edge; Reset only appears while a filter is
 * active. Controls match the app's `.input`/`.select` tokens — same height, radius,
 * border, focus ring — so the toolbar reads as part of the form system, not apart from it.
 *
 * The hook does the filtering; these components are the chrome. Searching matches the
 * joined text of `getText(row)`, lower-cased, so a page decides what is searchable —
 * typically the resolved names plus remarks, not the raw ids.
 */

import { useMemo, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { cx } from "@/lib/utils";
import { useT } from "@/features/i18n/i18n";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  /** State key on the filter bag, e.g. "wing" or "unit". */
  key: string;
  label: string;
  options: FilterOption[];
}

export interface UseRowFilterOptions<Row> {
  /** The searchable text for a row — usually the resolved display values joined. */
  getText: (row: Row) => string;
  /** Optional categorical filters. Each maps a key to the row's value for that key. */
  filters?: FilterDef[];
  /**
   * Resolves a row's value for a filter key.
   *
   * Returning an ARRAY means "this row carries several values for that key, match any of
   * them". That is not a convenience: an incident spanning three units is one row holding
   * three UnitIds, and an equality test against a single value could never express it.
   */
  getFilterValue?: (row: Row, key: string) => string | string[] | undefined | null;
}

export interface RowFilter<Row> {
  /** The rows surviving the current search + filter selections. */
  rows: Row[];
  /** Current search term. */
  query: string;
  setQuery: (q: string) => void;
  /** Current value per filter key ("" = no filter). */
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  /** True when a search or filter is active — the Reset button only renders then. */
  active: boolean;
  clear: () => void;
}

export function useRowFilter<Row>(source: Row[], opts: UseRowFilterOptions<Row>): RowFilter<Row> {
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const q = query.trim().toLowerCase();
  const active = q !== "" || Object.values(values).some((v) => v !== "");

  const rows = useMemo(() => {
    if (!active) return source;
    return source.filter((row) => {
      if (q && !opts.getText(row).toLowerCase().includes(q)) return false;
      if (opts.filters && opts.getFilterValue) {
        for (const f of opts.filters) {
          const sel = values[f.key];
          if (!sel) continue;
          const actual = opts.getFilterValue(row, f.key);
          const ok = Array.isArray(actual) ? actual.includes(sel) : (actual ?? "") === sel;
          if (!ok) return false;
        }
      }
      return true;
    });
  }, [source, q, values, active, opts]);

  const setValue = (key: string, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  const clear = () => {
    setQuery("");
    setValues({});
  };

  return { rows, query, setQuery, values, setValue, active, clear };
}

/* ----------------------------------------------------------------- controls */

/** A compact, icon-led search field. Reuses the app's input tokens for border/focus. */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  active = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  placeholder?: string;
  active?: boolean;
}) {
  // The default resolves here rather than in the parameter list so it can follow a
  // locale switch — a default parameter is evaluated per call, but only the component
  // body can reach the active locale through useT.
  const t = useT();
  return (
    <div className={cx("ftb-search", active && "active")}>
      <Search size={15} className="ftb-search-icon" aria-hidden />
      <input
        type="search"
        className="ftb-search-input"
        placeholder={placeholder ?? t("common.search")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* The UA cancel button is hidden in CSS; we render our own for keyboard + a11y. */}
      {active && onClear && (
        <button
          type="button"
          className="ftb-search-clear"
          aria-label={t("common.clearSearch")}
          onClick={onClear}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A labelled single-select filter that matches the app's select tokens. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <label className="ftb-select">
      <span className="ftb-select-label">{label}</span>
      <select
        className="ftb-select-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("common.all")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The Reset action. Ghost-styled; only meaningful when a filter is active. */
export function ClearFilters({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="ftb-reset" onClick={onClick}>
      <RotateCcw size={13} aria-hidden />
      {t("common.reset")}
    </button>
  );
}

/**
 * Live record count for the table header. Sits in the Card's actions slot, top-right of the
 * table, so it reads as a property of the table rather than a filter control.
 *
 * Only renders while a filter is active — the card's own `sub` already shows the unfiltered
 * total, so showing the same number here would be redundant. When filtering, it shows
 * "12 of 131 records" so the reader can see how much the filter removed.
 */
export function FilterCount({ filter, total }: { filter: RowFilter<unknown>; total: number }) {
  const t = useT();
  const f = filter;
  if (!f.active) return null;
  // The plural follows the TOTAL, not the filtered count: "1 of 2 records" must not
  // flip to singular halfway through the sentence when the filter leaves one row.
  return (
    <span className="ftb-count" aria-live="polite" title={t("common.filtered")}>
      {total === 1
        ? t("common.record.one", { n: f.rows.length, total })
        : t("common.record.many", { n: f.rows.length, total })}
    </span>
  );
}

/* ------------------------------------------------------------------ toolbar */

/**
 * Composes the controls into the standard row. `filters` must be the same array passed to
 * `useRowFilter`, so the Selects line up with the hook's filter state. A filter with one or
 * zero options narrows nothing and is not rendered.
 *
 * Layout: the search field fills the left and grows to use spare width; the dropdowns and a
 * Reset button are grouped at the right at a fixed width each, so they stay aligned and the
 * row reads "search … [fixed filters] [reset]". The record count is NOT rendered here — it
 * belongs in the table header (see `FilterCount`), near the title, not inside the controls.
 */
export function FilterToolbar<Row>({ filter, filters = [] }: {
  filter: RowFilter<Row>;
  filters?: FilterDef[];
}) {
  const f = filter;
  const usable = filters.filter((d) => d.options.length > 1);

  return (
    <div className="filter-toolbar">
      <SearchInput
        value={f.query}
        onChange={f.setQuery}
        onClear={f.clear}
        active={f.active}
      />

      <div className="ftb-filters">
        {usable.map((d) => (
          <FilterSelect
            key={d.key}
            label={d.label}
            value={f.values[d.key] ?? ""}
            options={d.options}
            onChange={(v) => f.setValue(d.key, v)}
          />
        ))}
        {f.active && <ClearFilters onClick={f.clear} />}
      </div>
    </div>
  );
}

/**
 * Alias kept so existing call sites (`<TableToolbar …/>`) compile unchanged. New code
 * should use `FilterToolbar` directly.
 */
export const TableToolbar = FilterToolbar;

