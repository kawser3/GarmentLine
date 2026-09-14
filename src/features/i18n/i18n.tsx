/**
 * UI-language state: the chosen locale, the translation lookup, and the switcher.
 *
 * Two sources feed `t()`, in this order:
 *
 *   1. the localization service, fetched once per load (`Key/Gets`, project key — a
 *      runtime read per the CLAUDE.md key table) — so a corrected wording reaches
 *      every browser without a deploy;
 *   2. the bundled dictionary (`dictionary.ts`), which renders the FIRST PAINT.
 *
 * The bundle always wins the race on purpose (§08: the service may be slow, absent
 * or refuse an anonymous visitor, and a blank shell while translations load is worse
 * than English). The service overlay only ever REPLACES strings that also exist in
 * the bundle — an overlay key with no bundled counterpart is dropped, so the service
 * cannot invent strings the types have never seen.
 *
 * Every failure of the overlay fetch is silent by the same reasoning: the app is
 * fully usable without it.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/blocks-api";
import { cx } from "@/lib/utils";
import { ButtonGroup } from "@/components/ui";
import {
  DICTIONARIES,
  LOCALES,
  SERVICE_KEY_PREFIX,
  type DictKey,
  type Locale,
} from "./dictionary";

const KEY = "bc.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* Private mode / storage disabled — fall through to the browser's language. */
  }
  // bn-BD is the only Bangla the product carries, so any Bangla browser gets it.
  return navigator.language?.toLowerCase().startsWith("bn") ? "bn-BD" : "en-US";
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Service strings that also exist in the bundle, per locale, keyed WITHOUT the `ip.` prefix. */
  overlay: Partial<Record<Locale, Record<string, string>>>;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(KEY, locale);
    } catch {
      /* Preference is cosmetic — losing it is not worth an error. */
    }
    // Screen readers switch pronunciation rules from this attribute.
    document.documentElement.lang = locale;
    set({ locale });
  },
  overlay: {},
}));

export type TFunc = (key: DictKey, vars?: Record<string, string | number>) => string;

/**
 * Resolve one string: overlay → dictionary for the active locale → English.
 *
 * The English floor is what makes a half-translated feature shippable — a missing
 * bn-BD key cannot happen (the type forbids it), but an overlay that is a release
 * behind the bundle can, and "Status" in an English sentence beats a blank.
 */
function resolve(locale: Locale, overlay: I18nState["overlay"], key: DictKey): string {
  const over = overlay[locale]?.[key];
  if (typeof over === "string" && over) return over;
  const dict = DICTIONARIES[locale] as Record<string, string>;
  return dict[key] ?? (DICTIONARIES["en-US"] as Record<string, string>)[key];
}

export function useT(): TFunc {
  const locale = useI18nStore((s) => s.locale);
  const overlay = useI18nStore((s) => s.overlay);
  return (key, vars) => {
    let str = resolve(locale, overlay, key);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        str = str.replaceAll(`{${name}}`, String(value));
      }
    }
    return str;
  };
}

/*
 * The raw dictionaries stay reachable without React — format.ts and the push script
 * share this resolution so a formatted date and its label always speak one language.
 * Interpolation matches t() for the non-React call sites (memos that must not depend
 * on t's fresh closure every render).
 */
export function translate(
  locale: Locale,
  key: DictKey,
  vars?: Record<string, string | number>,
): string {
  let str = resolve(locale, {}, key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replaceAll(`{${name}}`, String(value));
    }
  }
  return str;
}

/** Service shape of `POST /localization/v4/Key/Gets` — verified live, see PLAN §08. */
interface ServiceKeys {
  keys?: {
    keyName?: string;
    resources?: { culture?: string; value?: string | null }[];
  }[];
}

async function fetchOverlay(): Promise<I18nState["overlay"]> {
  const res = await api<ServiceKeys>("/localization/v4/Key/Gets", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const bundled = new Set(Object.keys(DICTIONARIES["en-US"]));
  const out: I18nState["overlay"] = {};
  for (const k of res.keys ?? []) {
    // The service returns every key on the tenant (895+); ours carry the ip. prefix.
    if (!k.keyName?.startsWith(SERVICE_KEY_PREFIX)) continue;
    const short = k.keyName.slice(SERVICE_KEY_PREFIX.length);
    // A service key the bundle does not know is dropped, not adopted — the types,
    // not the tenant, decide which strings exist.
    if (!bundled.has(short)) continue;
    for (const r of k.resources ?? []) {
      if (r.culture !== "en-US" && r.culture !== "bn-BD") continue;
      if (typeof r.value !== "string" || !r.value) continue;
      const bucket = (out[r.culture] ??= {});
      bucket[short] = r.value;
    }
  }
  return out;
}

let overlayStarted = false;

/**
 * Load the service overlay once per app load. Called from App so the login screen
 * is covered too — translations are anonymous runtime reads, not a session feature.
 */
export function useI18nOverlay() {
  useEffect(() => {
    if (overlayStarted) return;
    overlayStarted = true;
    fetchOverlay()
      .then((overlay) => useI18nStore.setState({ overlay }))
      .catch(() => {
        /* Silent by design — see the file comment. */
      });
  }, []);
}

/** EN / DE segmented control, topbar. */
export function LanguageSwitcher() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  return (
    <ButtonGroup>
      {(
        [
          ["en-US", "EN"],
          ["bn-BD", "BN"],
        ] as const
      ).map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={cx("btn", "sm", locale === code && "primary")}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
          title={code === "en-US" ? "English" : "Schwiizerdütsch"}
        >
          {label}
        </button>
      ))}
    </ButtonGroup>
  );
}
