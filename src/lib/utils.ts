/** Join class names. Replaces clsx/tailwind-merge — there is no Tailwind here to merge. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Format an amount. Currency is a suffix so decimal points stay aligned in a column. */
export function fmtMoney(v: number | null | undefined, currency = "CHF") {
  if (v == null || Number.isNaN(v)) return "—";
  return `${money.format(v)} ${currency}`;
}

export function fmtNumber(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return money.format(v);
}

/** Short form for the stat tiles, where a full 90'551.58 would overflow. */
export function fmtCompact(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return compact.format(v);
}

/** Sign class for money. Paired with an explicit +/- so colour is never the only cue. */
export function signClass(v: number | null | undefined) {
  if (!v) return undefined;
  return v < 0 ? "neg" : "pos";
}

export function fmtSigned(v: number | null | undefined, currency = "CHF") {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "+";
  return `${sign}${money.format(Math.abs(v))} ${currency}`;
}

/** Sort helpers — the gateway has no server-side ordering, so lists sort here. */
export function byText<T>(get: (t: T) => string | null | undefined) {
  return (a: T, b: T) => (get(a) ?? "").localeCompare(get(b) ?? "");
}

export function byNumber<T>(get: (t: T) => number | null | undefined, desc = false) {
  return (a: T, b: T) => {
    const d = (get(a) ?? 0) - (get(b) ?? 0);
    return desc ? -d : d;
  };
}

/** "2026-07" -> "July 2026" */
export function fmtPeriod(period: string | null | undefined) {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Last `count` periods ending at `end` (default: current month), newest first. */
export function recentPeriods(count = 12, end = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Initials for the header avatar. */
export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Lowercase, hyphenated — the console renders identifiers this way. */
export function slug(s: string | null | undefined) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
