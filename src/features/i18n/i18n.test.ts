/**
 * Dictionary integrity and locale formatters. Run with `npm test`.
 *
 * The TYPE already forbids a missing bn-BD key (Dict is Record over the en keys),
 * which fails the build. These runtime checks catch what a type cannot see:
 *   - a key present but empty — renders as a blank where a word belongs;
 *   - a {placeholder} dropped or renamed in one language — renders as a literal
 *     "{n}" to half the readers;
 *   - a value left in English — the key exists, so the type is satisfied, but the
 *     reader gets someone else's language;
 *   - stray whitespace — invisible in review, visible as a gap in the UI.
 * Then the formatters: the exact shape each locale produces is pinned here,
 * because a date that reads 05/09 in one place and 09/05 in another is how a
 * register becomes unusable for forensics.
 */
import { bnBD, DICTIONARIES, enUS } from "./dictionary";
import { formatClock, formatDate, formatMonthShort, formatPeriod } from "@/lib/format";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${String(got)}${ok ? "" : `  (want ${String(want)})`}`,
  );
}
function ok(label: string, condition: boolean, detail = "") {
  check(label, condition, true);
  if (!condition && detail) console.log(`      ${detail}`);
}

const enKeys = Object.keys(enUS);
check("bn-BD carries every en-US key", Object.keys(bnBD).length, enKeys.length);

/* ------------------------------------------------------- per-key hygiene ---- */
const PLACEHOLDER = /\{(\w+)\}/g;
let empties = 0, droppedTokens = 0, untranslated = 0, whitespace = 0;
const firstOf = <T,>(arr: T[]) => arr[0];
/* Every Bangla string must actually carry Bengali script. A value copied
 * across from English satisfies the type and fails the reader. */
const BENGALI = /[\u0980-\u09FF]/;
const offenders: Record<string, string[]> = { empty: [], token: [], latin: [], space: [] };
for (const key of enKeys) {
  const en = enUS[key as keyof typeof enUS];
  const bn = bnBD[key as keyof typeof bnBD];

  if (!bn || !bn.trim()) {
    empties++;
    offenders.empty.push(key);
    continue;
  }
  // Same {tokens} in both directions — a missing one renders literally.
  const enTokens = [...en.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
  const bnTokens = [...bn.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
  if (enTokens.join(",") !== bnTokens.join(",")) {
    droppedTokens++;
    offenders.token.push(key);
  }
  if (!BENGALI.test(bn)) {
    untranslated++;
    offenders.latin.push(key);
  }
  if (bn !== bn.trim() || /\s{2,}/.test(bn)) {
    whitespace++;
    offenders.space.push(key);
  }
}
ok("no empty bn-BD values", empties === 0, firstOf(offenders.empty) ?? "");
ok("every {placeholder} present in both languages", droppedTokens === 0, firstOf(offenders.token) ?? "");
ok("every bn-BD value is written in Bengali", untranslated === 0, firstOf(offenders.latin) ?? "");
ok("no leading/trailing or doubled spaces", whitespace === 0, firstOf(offenders.space) ?? "");

/* ------------------------------------------------------------ formatters ---- */
const when = new Date("2026-03-05T14:05:00");
check("formatDate en reads day-first", formatDate(when, "en-US"), "05 Mar 2026");
check("formatDate bn-BD is numeric dd/MM/yyyy", formatDate(when, "bn-BD"), "05/03/2026");
check("formatClock en is the 24-hour clock", formatClock(when, "en-US"), "14:05");
check("formatClock bn-BD is the 24-hour clock", formatClock(when, "bn-BD"), "14:05");
check("formatPeriod en spells the month", formatPeriod("2026-07", "en-US"), "July 2026");
check("formatPeriod bn-BD spells the month", formatPeriod("2026-07", "bn-BD"), "July 2026");
check("formatPeriod renders a missing period as a dash", formatPeriod(null, "bn-BD"), "—");
check("formatMonthShort bn-BD abbreviates", formatMonthShort("2026-03", "bn-BD"), "Mar");
check("formatMonthShort en abbreviates", formatMonthShort("2026-03", "en-US"), "Mar");

/* ---------------------------------------------------- bundled dictionaries ---- */
// The switcher offers exactly what is bundled — a locale in LOCALES without a
// dictionary is a blank screen, and a dictionary without a LOCALES entry is
// unreachable dead weight.
check("DICTIONARIES cover exactly the offered locales", Object.keys(DICTIONARIES).sort().join(","), "bn-BD,en-US");

process.exit(failures ? 1 : 0);
