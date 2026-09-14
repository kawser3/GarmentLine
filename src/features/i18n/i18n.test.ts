/**
 * Dictionary integrity and locale formatters. Run with `npm test`.
 *
 * The TYPE already forbids a missing bn-BD key (Dict is Record over the en keys),
 * which fails the build. These runtime checks catch what a type cannot see:
 *   - a key present but empty — renders as a blank where a word belongs;
 *   - a {placeholder} dropped or renamed in one language — renders as a literal
 *     "{n}" to half the readers;
 *   - a ß slipped in from de-DE habits — wrong on sight in Switzerland (§08);
 *   - stray whitespace — invisible in review, visible as a gap in the UI.
 * Then the formatters: an English date that reads 05/09 and a Swiss one that
 * reads 09.05. is how a register becomes unusable for forensics, so the exact
 * shapes each locale produces are pinned here.
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
let empties = 0, droppedTokens = 0, sharpS = 0, whitespace = 0;
const firstOf = <T,>(arr: T[]) => arr[0];
const offenders: Record<string, string[]> = { empty: [], token: [], eszett: [], space: [] };
for (const key of enKeys) {
  const en = enUS[key as keyof typeof enUS];
  const bn = bnBD[key as keyof typeof bnBD];

  if (!de || !de.trim()) {
    empties++;
    offenders.empty.push(key);
    continue;
  }
  // Same {tokens} in both directions — a missing one renders literally.
  const enTokens = [...en.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
  const deTokens = [...de.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
  if (enTokens.join(",") !== deTokens.join(",")) {
    droppedTokens++;
    offenders.token.push(key);
  }
  if (/ß/.test(bn)) {
    sharpS++;
    offenders.eszett.push(key);
  }
  if (de !== de.trim() || /\s{2,}/.test(bn)) {
    whitespace++;
    offenders.space.push(key);
  }
}
ok("no empty bn-BD values", empties === 0, firstOf(offenders.empty) ?? "");
ok("every {placeholder} present in both languages", droppedTokens === 0, firstOf(offenders.token) ?? "");
ok("no ß anywhere in bn-BD (Swiss orthography)", sharpS === 0, firstOf(offenders.eszett) ?? "");
ok("no leading/trailing or doubled spaces", whitespace === 0, firstOf(offenders.space) ?? "");

/* ------------------------------------------------------------ formatters ---- */
const when = new Date("2026-03-05T14:05:00");
check("formatDate en reads day-first", formatDate(when, "en-US"), "05 Mar 2026");
check("formatDate bn-BD is numeric dd.MM.yyyy", formatDate(when, "bn-BD"), "05.03.2026");
check("formatClock en is the 24-hour clock", formatClock(when, "en-US"), "14:05");
check("formatClock bn-BD is the 24-hour clock", formatClock(when, "bn-BD"), "14:05");
check("formatPeriod en spells the month", formatPeriod("2026-07", "en-US"), "July 2026");
check("formatPeriod bn-BD spells the month", formatPeriod("2026-07", "bn-BD"), "Juli 2026");
check("formatPeriod renders a missing period as a dash", formatPeriod(null, "bn-BD"), "—");
check("formatMonthShort bn-BD keeps the umlaut", formatMonthShort("2026-03", "bn-BD"), "Mär");
check("formatMonthShort en abbreviates", formatMonthShort("2026-03", "en-US"), "Mar");

/* ---------------------------------------------------- bundled dictionaries ---- */
// The switcher offers exactly what is bundled — a locale in LOCALES without a
// dictionary is a blank screen, and a dictionary without a LOCALES entry is
// unreachable dead weight.
check("DICTIONARIES cover exactly the offered locales", Object.keys(DICTIONARIES).sort().join(","), "bn-BD,en-US");

process.exit(failures ? 1 : 0);
