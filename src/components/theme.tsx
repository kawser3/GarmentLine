import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cx } from "@/lib/utils";

type Theme = "dark" | "light";

const STORAGE_KEY = "blocks-incident.theme";

/**
 * The product is DARK-ONLY for now (PLAN §07).
 *
 * The surfaces in the design system — #0A0E1A behind everything, #121729 for
 * panels, hairline borders at 9% — have no validated light counterpart, and
 * inventing one by inversion is how you end up with a second theme that looks
 * wrong everywhere. So light is on the roadmap rather than half-present.
 *
 * The light tokens are still in index.css and still correct; nothing selects
 * them. Restoring the switch is re-exposing the toggle, not rebuilding a theme.
 *
 * The exception is the report PDF, which is always paper — white ground, dark
 * ink — and has its own palette in features/reports. It never reads this.
 */
function readInitial(): Theme {
  return "dark";
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    // The palette switches on a data attribute, so one write flips the whole app.
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not fatal — the theme just won't persist.
    }
  }, [theme]);

  // Kept so every consumer of useTheme() still type-checks while the product is
  // dark-only. Nothing renders a control that calls it.
  const toggle = useCallback(() => setTheme("dark"), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      className={cx("btn", "sm", "quiet")}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
    >
      <Icon size={14} aria-hidden />
      {theme === "dark" ? "Light" : "Dark"} theme
    </button>
  );
}
