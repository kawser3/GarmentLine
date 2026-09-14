/**
 * Number and duration formatting.
 *
 * Separate from `utils.ts` because the currency is a runtime setting here, not a constant.
 * `Intl.NumberFormat` instances are expensive enough that building one per table cell is
 * visible on the packages comparison, so they are cached per (currency, precision).
 */

const moneyCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, min: number, max: number): Intl.NumberFormat {
  const key = `${currency}|${min}|${max}`;
  let f = moneyCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: min,
        maximumFractionDigits: max,
      });
    } catch {
      // An admin can type anything into the currency setting. A bad ISO code must not take
      // the page down — fall back to a plain number and let the code show as a suffix.
      f = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: min,
        maximumFractionDigits: max,
      });
    }
    moneyCache.set(key, f);
  }
  return f;
}

/** True when `currency` is something Intl will accept as an ISO 4217 code. */
function isKnownCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
    return true;
  } catch {
    return false;
  }
}

/** A total or a line amount, at the configured precision. */
export function formatMoney(
  value: number | null | undefined,
  currency: string,
  precision = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = moneyFormatter(currency, precision, precision).format(value);
  return isKnownCurrency(currency) ? text : `${text} ${currency}`;
}

/**
 * A unit price, which may be a small fraction of a cent.
 *
 * Fixed two decimals would render the entire rate card's sub-cent half as "$0.00" — the
 * per-user price, the per-email price, the per-credit price — so the precision follows the
 * magnitude. Four decimals covers every price in the source rate card (the smallest is
 * 0.0001) without printing trailing zeros on the whole-currency ones.
 */
export function formatUnitPrice(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return formatMoney(0, currency, 2);
  const decimals = Math.abs(value) < 0.01 ? 4 : 2;
  const text = moneyFormatter(currency, 2, decimals).format(value);
  return isKnownCurrency(currency) ? text : `${text} ${currency}`;
}

const quantityFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** A count or a measured amount. Never a currency. */
export function formatQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return quantityFormatter.format(value);
}

/** `250 users`, or just `250` when the feature has no unit label. */
export function formatWithUnit(
  value: number | null | undefined,
  unitLabel: string | null | undefined,
): string {
  const n = formatQuantity(value);
  if (n === "—") return n;
  const unit = (unitLabel ?? "").trim();
  if (!unit) return n;
  // Units already written as a rate ("/ month", "emails / month") read wrong with a space
  // inserted before the slash, so only the leading separator is added.
  return `${n} ${unit}`;
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** `10K` — for the comparison table, where a column of full numbers will not fit. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // Below ten thousand the compact form saves nothing and costs precision: "5K" for 5,000 is
  // fine, but "1.5K" for 1,500 is strictly worse than "1,500".
  return Math.abs(value) >= 10_000 ? compactFormatter.format(value) : quantityFormatter.format(value);
}

/*
 * Dates for the incident UI (§08). The app's two UI locales map onto Intl locales with a
 * deliberate twist: English stays en-GB, not en-US, because the register has always read
 * day-first ("05 Sep 2026") and choosing American wording must not silently reverse the
 * columns — an incident register where 05/09 could mean either is unusable for forensics.
 * bn-BD maps to en-GB numerics: dd/MM/yyyy with a 24-hour clock, which is how dates are
 * written on the floor. Bangla numerals are deliberately not used - a date on an audit
 * trail is read by buyers too.
 */
export type UiLocale = "en-US" | "bn-BD";

function intlLocale(ui: UiLocale): string {
  return ui === "bn-BD" ? "en-GB" : "en-GB";
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFmt(ui: UiLocale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${ui}|${JSON.stringify(opts)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(ui), opts);
    dateCache.set(key, f);
  }
  return f;
}

/** `05 Sep 2026` / `05.09.2026` — short month in English, numeric in Swiss German. */
export function formatDate(value: string | Date, ui: UiLocale): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt(ui, {
    day: "2-digit",
    month: ui === "bn-BD" ? "2-digit" : "short",
    year: "numeric",
  }).format(d);
}

/** The clock half of a timestamp — 24-hour in both locales, no seconds. */
export function formatClock(value: string | Date, ui: UiLocale): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt(ui, { hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Long month + year for a "2026-07" period — `July 2026` / `Juli 2026`. */
export function formatPeriod(period: string | null | undefined, ui: UiLocale): string {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return dateFmt(ui, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

/** Short month name for a chart axis tick; period form ("2026-07") or a date. */
export function formatMonthShort(value: string | Date, ui: UiLocale): string {
  const d = value instanceof Date ? value : new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt(ui, { month: "short", timeZone: value instanceof Date ? undefined : "UTC" }).format(d);
}
