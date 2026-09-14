import { create } from "zustand";

/**
 * Shell preferences — currently just whether the sidebar is collapsed to icons.
 *
 * Persisted by hand rather than with zustand's persist middleware: it is one boolean, and a
 * failed read (private mode, storage disabled) must fall back to expanded rather than throw
 * before the application has rendered anything.
 */
const KEY = "bc.sidebar-collapsed";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* Preference is cosmetic — losing it is not worth an error. */
  }
}

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /**
   * Whether the navigation drawer is showing on a phone.
   *
   * Deliberately NOT persisted, unlike `sidebarCollapsed`. Collapsing the desktop sidebar is a
   * preference; having the mobile drawer open is a momentary state, and restoring it on the
   * next visit would mean the app opens with its content covered.
   */
  mobileNavOpen: boolean;
  setMobileNav: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: read(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    write(next);
    set({ sidebarCollapsed: next });
  },
  mobileNavOpen: false,
  setMobileNav: (open) => set({ mobileNavOpen: open }),
}));
