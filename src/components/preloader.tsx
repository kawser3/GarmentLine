import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";


/**
 * The centred logo preloader, for the two waits people actually see.
 *
 * **The load.** `index.html` paints the overlay itself, because React is what we are waiting
 * for — the bundle has to be fetched, parsed and executed before it can render anything. This
 * component's job there is only to take it away, and not before the first screen has something
 * to show: removing it the moment React mounts would replace one spinner with another.
 *
 * **The transition.** Routes are not lazily loaded, so navigation costs nothing by itself — the
 * wait is the new page's data. That makes an unconditional overlay wrong: most navigations hit
 * a warm cache and finish in a frame, and an overlay over a page that is already complete reads
 * as a fault. So it waits {@link SHOW_AFTER} before showing anything, and shows it only if
 * something is genuinely still in flight.
 *
 * Both directions are damped. Nothing appears for a wait too short to notice, and once it does
 * appear it stays {@link MIN_VISIBLE} — a preloader that flickers on and off costs more
 * attention than the wait it was hiding.
 */

/** How long a transition must exceed before an overlay is worth showing. */
const SHOW_AFTER = 140;

/** Once shown, how long it stays — enough to read as a state rather than a flash. */
const MIN_VISIBLE = 420;

/**
 * The floor on the boot overlay.
 *
 * Two jobs. Queries start during the first render, so `useIsFetching` is still 0 on the first
 * effect and without a floor the overlay would leave before the app had asked for anything.
 * It also keeps the print animation from being cut off mid-word on a warm reload.
 */
const MIN_BOOT = 620;

/**
 * The ceiling on it.
 *
 * A slow or failing gateway must not hold the whole app behind a logo — the pages have their
 * own skeletons and empty states, which say far more about what is happening than this does.
 */
const MAX_BOOT = 3500;

/** Matches the fade in index.html; removing the node sooner would cut it off. */
const FADE = 280;

const BOOT_ID = "boot-preload";

/**
 * Take the boot overlay away.
 *
 * Exported because the overlay outlives this component in one case: `main.tsx` renders the
 * configuration-error page INSTEAD of the app, so nothing ever mounts a `<Preloader/>` and the
 * error would sit invisible behind a logo — the exact failure the error page exists to explain.
 * Found by loading the built app on an origin the API cannot be derived from.
 */
export function dismissBootPreloader() {
  const node = document.getElementById(BOOT_ID);
  if (!node) return;
  node.classList.add("leaving");
  window.setTimeout(() => node.remove(), FADE);
}

export function Preloader() {
  const { pathname } = useLocation();
  const fetching = useIsFetching();

  /*
   * The session probe (`loadSession`) is a plain fetch, invisible to `useIsFetching`.
   * Without this subscription the overlay left after MIN_BOOT while auth status was
   * still "unknown", and the route guard underneath flashed its checking shell —
   * or the login page, when the probe then resolved the other way — for a frame.
   * MAX_BOOT still bounds the wait, so a dead IAM cannot hide the app forever.
   */
  const sessionUnknown = useAuthStore((s) => s.status === "unknown");

  const [bootDone, setBootDone] = useState(() => !document.getElementById(BOOT_ID));
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  /*
   * Read inside a timer rather than closed over, so the timer sees the current value without
   * the show/hide effects re-arming every time a query starts or settles.
   */
  const fetchingRef = useRef(fetching);
  fetchingRef.current = fetching;

  /* ------------------------------------------------------------------ the load */
  useEffect(() => {
    if (bootDone) return;

    const remove = () => {
      dismissBootPreloader();
      setBootDone(true);
    };

    // The ceiling runs regardless of what the gateway is doing.
    const cap = window.setTimeout(remove, MAX_BOOT);

    /*
     * Still loading: leave it up. This effect re-runs when `fetching` drops or the session
     * probe settles, which is what schedules the removal — so the overlay covers the whole
     * first fetch and the auth check, not just the mount.
     */
    if (fetching > 0 || sessionUnknown) return () => window.clearTimeout(cap);

    const floor = window.setTimeout(remove, MIN_BOOT);
    return () => {
      window.clearTimeout(cap);
      window.clearTimeout(floor);
    };
  }, [bootDone, fetching, sessionUnknown]);

  /* ------------------------------------------------------------ the transition */
  const navigations = useRef(0);
  useEffect(() => {
    navigations.current += 1;
    // The first run is the mount, which the boot overlay already covers.
    if (navigations.current === 1) return;

    const id = window.setTimeout(() => {
      if (fetchingRef.current === 0) return;
      shownAt.current = performance.now();
      setVisible(true);
    }, SHOW_AFTER);
    return () => window.clearTimeout(id);
  }, [pathname]);

  useEffect(() => {
    if (!visible || fetching > 0) return;
    const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt.current));
    const id = window.setTimeout(() => setVisible(false), wait);
    return () => window.clearTimeout(id);
  }, [visible, fetching]);

  if (!visible) return null;

  /*
   * The same treatment the boot overlay in index.html uses, so the React
   * transition and the pre-bundle overlay are visibly one thing rather than two
   * loaders that happen to look similar: the product name, and a single thin
   * indeterminate bar as the only motion.
   */
  return (
    <div className="preload enter" role="status" aria-label="Loading…">
      <span className="preload-mark">
        <span className="preload-name">GarmentLine</span>
        <span className="preload-bar" aria-hidden />
      </span>
    </div>
  );
}
