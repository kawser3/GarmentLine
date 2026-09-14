/**
 * CSV export.
 *
 * A cost estimate does not end in the app: it gets forwarded to a manager, pasted into a
 * budget sheet, or attached to a procurement request. Without this the answer to "can you
 * send me that" is a screenshot.
 */

/** Escape one cell. Quotes are doubled, and anything with a delimiter gets quoted. */
function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Build CSV text.
 *
 * Numbers are written unformatted (`3500.5`, not `3'500.50 CHF`) so the receiving spreadsheet
 * reads them as numbers. Formatting is for the screen; a CSV that needs cleaning before it can
 * be summed is not an export.
 */
export function toCsv<T>(rows: T[], columns: Array<Column<T>>): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")).join("\n");
  /*
   * A BOM so Excel opens UTF-8 correctly — feature names carry currency symbols and the
   * comparison text carries typographic dashes and bullets.
   *
   * Written as the escape rather than the literal character: pasted literally it is invisible
   * in every editor, which is exactly how someone "tidies up" the leading whitespace and
   * silently breaks Excel's encoding detection. (It also trips eslint's no-irregular-whitespace.)
   */
  return `\uFEFF${head}\n${body}\n`;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: Array<Column<T>>) {
  const blob = new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `garmentline-estimate-2026-08-15.csv` */
export function exportName(kind: string, scope: string) {
  return `garmentline-${kind}-${scope}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}
