import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Briefcase,
  Factory,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardCheck,
  Shirt,
  Users,
} from "lucide-react";
import {
  canManageMasterData,
  canManagePeople,
  canSeeManagementView,
  isInternal,
  rolesOf,
  useAuthStore,
} from "@/stores/auth";
import { ThemeToggle } from "@/components/theme";
import { useUiStore } from "@/stores/ui";
import { LanguageSwitcher, useT } from "@/features/i18n/i18n";
import type { DictKey } from "@/features/i18n/dictionary";
import { cx, initials } from "@/lib/utils";

/**
 * The application shell.
 *
 * Four destinations, in the order the work happens: what needs attention now (dashboard), the
 * issue log, the sample approvals behind it, and the factory setup. A Buyer sees only
 * their report, so the nav is filtered by role rather than rendering links that refuse.
 */
interface NavItem {
  to: string;
  /** Dictionary key — the sidebar is chrome, so it speaks the UI language (§08). */
  label: DictKey;
  icon: typeof LayoutDashboard;
  /** Hidden from a Client, who holds none of the internal roles. */
  internal?: boolean;
  /** The management view: aggregates and cost impact, which only the GM sees in full. */
  management?: boolean;
  /** Administrative: reshaping the organisation, not reading it. */
  master?: boolean;
  /** People administration, a narrower audience than master data. */
  people?: boolean;
}

const NAV: { group: DictKey; items: NavItem[] }[] = [
  {
    group: "nav.group.production",
    items: [
      { to: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard, internal: true, management: true },
      { to: "/issues", label: "nav.issues", icon: ListFilter },
      { to: "/samples", label: "nav.samples", icon: ClipboardCheck },
    ],
  },
  {
    group: "nav.group.configuration",
    items: [
      /* One destination per master table. These were a tab strip inside a single
       * "Master data" page; the sidebar already navigates, so the tabs were a second
       * navigation for the same three places. */
      { to: "/buyers", label: "nav.buyers", icon: Briefcase, internal: true, master: true },
      { to: "/styles", label: "nav.styles", icon: Shirt, internal: true, master: true },
      { to: "/lines", label: "nav.lines", icon: Factory, internal: true, master: true },
      { to: "/people", label: "nav.people", icon: Users, internal: true, people: true },
    ],
  },
];

/**
 * The mark: a running stitch that resolves into a check.
 *
 * The two halves of what this app records — work done on the floor, and the
 * decision that a sample passed. Drawn inline rather than loaded as an image so
 * it inherits the theme and costs no request; public/favicon.svg is the same
 * glyph on a fixed blue tile, because a favicon cannot read a CSS variable.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="GarmentLine"
    >
      <rect width="32" height="32" rx="7.5" fill="var(--primary)" />
      <path
        d="M7.6 16.9 L13.3 22.6 L24.6 9.6"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 3.2"
      />
    </svg>
  );
}

/**
 * The sidebar lockup: the mark, the product name, the platform it runs on.
 */
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className="brand-lockup">
      {/* Survives the collapse to an icon rail, where the wordmark is hidden —
          an empty header row reads as a broken layout rather than a choice. */}
      <BrandMark size={size === "lg" ? 30 : 26} />
      <div>
        <div className={size === "lg" ? "brand-name brand-name-lg" : "brand-name"}>GarmentLine</div>
        <div className="sub">SELISE Blocks</div>
      </div>
    </div>
  );
}

/** Is the viewport wide enough that the sidebar is a column rather than a drawer? */
function useIsWideViewport() {
  const query = "(min-width: 861px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    setWide(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const t = useT();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const isWide = useIsWideViewport();

  /*
   * `sidebarCollapsed` is a DESKTOP preference, and it persists. Below the drawer breakpoint
   * the sidebar is an overlay where "collapsed to icons" has no meaning, and several of the
   * collapsed rules zero out padding — which pins the sign-out button flat against the
   * drawer's edge. Gating the class here rather than neutralising each rule in CSS, so a rule
   * added later cannot leak the same way.
   */
  const collapsedEffective = collapsed && isWide;

  /* Escape closes the drawer, and while it is open the page behind must not scroll. */
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNav(false);
    };
    document.addEventListener("keydown", onKey);

    /*
     * Close on growing past the drawer breakpoint. Without this, rotating a phone to landscape
     * leaves the scroll lock in place and the page frozen, with no visible drawer to explain why.
     */
    const wide = window.matchMedia("(min-width: 861px)");
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileNav(false);
    };
    wide.addEventListener("change", onWide);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen, setMobileNav]);

  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || t("shell.signedIn");
  // rolesOf flattens both shapes /iam/me can return — see the note in stores/auth.
  // The slug is translated for display only; what gets STORED everywhere is the slug.
  const slug = rolesOf(user)[0];
  // `|| slug`: a role the dictionary has never met still shows its raw slug rather
  // than an empty line — the server can hold roles the bundle does not know yet.
  const role = slug ? t(`role.${slug}` as DictKey) || slug : t("shell.defaultRole");

  return (
    <div className="app">
      {mobileNavOpen && (
        <div className="nav-backdrop no-print" onClick={() => setMobileNav(false)} aria-hidden />
      )}

      <aside
        className={cx(
          "sidebar no-print",
          collapsedEffective && "collapsed",
          mobileNavOpen && "open",
        )}
      >
        <div className="sidebar-brand">
          <div className="brand-text">
            <Brand />
          </div>
          {/*
            One button, two jobs, chosen by whether the drawer is open rather than by a viewport
            check. On a phone the drawer is open, so this closes it — which is what people reach
            for, since it sits where a close control belongs. On desktop the drawer is never
            open, so it keeps collapsing the sidebar to icons.
          */}
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            onClick={() => (mobileNavOpen ? setMobileNav(false) : toggleSidebar())}
            aria-expanded={mobileNavOpen ? true : !collapsedEffective}
            aria-label={
              mobileNavOpen
                ? t("shell.closeNav")
                : collapsedEffective
                  ? t("shell.expandNav")
                  : t("shell.collapseNav")
            }
          >
            {!mobileNavOpen && collapsedEffective ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
        </div>

        {NAV.map((g) => {
          const items = g.items.filter(
            (n) =>
              (!n.internal || isInternal(user)) &&
              (!n.management || canSeeManagementView(user)) &&
              (!n.master || canManageMasterData(user)) &&
              (!n.people || canManagePeople(user)),
          );
          if (!items.length) return null;
          return (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{t(g.group)}</div>
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                /* Collapsed, the icon is the only label — so the tooltip carries the name.
                   Expanded it would just repeat visible text, so it is left off. */
                title={collapsedEffective ? t(n.label) : undefined}
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                // Following a link must dismiss the drawer, or the destination renders behind it.
                onClick={() => setMobileNav(false)}
              >
                <n.icon size={16} aria-hidden />
                <span className="nav-label">{t(n.label)}</span>
              </NavLink>
            ))}
          </div>
          );
        })}

        <div className="sidebar-foot">
          <div className="user-row">
            <span className="user-avatar" aria-hidden title={collapsedEffective ? name : undefined}>
              {initials(name)}
            </span>
            <div className="user-meta">
              <div className="user-name" title={name}>
                {name}
              </div>
              <div className="user-role">{role}</div>
            </div>
            <NavLink
              to="/account/password"
              className="icon-btn"
              title={t("shell.changePassword")}
              aria-label={t("shell.changePassword")}
              onClick={() => setMobileNav(false)}
            >
              <KeyRound size={15} />
            </NavLink>
            <button
              type="button"
              className="icon-btn"
              title={t("shell.signOut")}
              aria-label={t("shell.signOut")}
              onClick={() => void logout()}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          {/* Visible only below the drawer breakpoint — see .nav-toggle in index.css. */}
          <button
            type="button"
            className="icon-btn nav-toggle"
            onClick={() => setMobileNav(!mobileNavOpen)}
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? t("shell.closeNav") : t("shell.openNav")}
          >
            <Menu size={18} />
          </button>

          <div className="toolbar-spacer" />

          {/* The two shell controls that are not navigation — language and theme
              belong to the person, not the route. */}
          <ThemeToggle />
          <LanguageSwitcher />
        </header>

        <main className="content">
          <Outlet />
          <div className="page-foot">
            {t("shell.pageFoot")}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Standard page heading: title, one line of context, page-level actions. */
export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="row no-print">{actions}</div>}
    </header>
  );
}
