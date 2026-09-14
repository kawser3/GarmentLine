import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

const STORAGE_KEY = "blocks-incident.theme";

/**
 * Dark-first, with the light palette one click away.
 *
 * The design system was drawn dark (#0A0E1A ground, #121729 panels, hairline
 * borders) — that stays the default. Both token sets live in index.css and both
 * are maintained; the palette switches on the data-theme attribute, so one write
 * flips the whole app. The choice persists per browser.
 *
 * The report PDF is always paper — white ground, dark ink — and has its own
 * palette in features/reports. It never reads this.
 */
function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Storage blocked — fall through to the default. */
  }
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

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

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
      className="icon-btn"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon size={15} aria-hidden />
    </button>
  );
}
