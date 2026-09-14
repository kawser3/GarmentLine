/**
 * Blocking progress modal for operations that take long enough to look broken.
 *
 * Import, generate-from-recurring and bulk delete all loop over hundreds of rows four at a
 * time. Without a modal the page simply sits there: a second click starts the work twice, and
 * on the delete paths that is not recoverable. So the dialog is deliberately *blocking* — it
 * exists as much to stop input as to reassure.
 *
 * Built on the native `<dialog>` for the same reasons as `confirm.tsx`: focus trap, top layer
 * and inert background come from the platform. Unlike a confirm, it deliberately does NOT
 * close on Escape or a backdrop click — the work is still running, and dismissing the only
 * indication that something is happening is not a dismissal anyone means.
 *
 *   const busy = useBusy();
 *   await busy.run("Generating recurring charges…", async (report) => {
 *     for (const [i, row] of rows.entries()) {
 *       await write(row);
 *       report(i + 1, rows.length);
 *     }
 *   });
 *
 * `run` resolves with the callback's return value and re-throws its error after showing a
 * failure notice, so callers keep normal try/catch control flow.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

/** Called from inside the work to advance the counter. `total` may change as it is discovered. */
export type ReportProgress = (done: number, total?: number, label?: string) => void;

export interface BusyApi {
  run<T>(message: string, work: (report: ReportProgress) => Promise<T>): Promise<T>;
}

const BusyContext = createContext<BusyApi | null>(null);

export function useBusy(): BusyApi {
  const api = useContext(BusyContext);
  if (!api) throw new Error("useBusy needs a <BusyProvider> above it");
  return api;
}

interface BusyState {
  message: string;
  done: number;
  total: number | null;
  label: string | null;
}

interface Toast {
  tone: "success" | "danger";
  text: string;
}

export function BusyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BusyState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (state && !el.open) el.showModal();
    else if (!state && el.open) el.close();
  }, [state]);

  // Notifications clear themselves; a stale "done" banner above fresh data is worse than none.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "danger" ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback<BusyApi["run"]>(async (message, work) => {
    setToast(null);
    setState({ message, done: 0, total: null, label: null });
    /*
     * Progress arrives from a tight loop, so it is throttled to ~10/s. Re-rendering a modal on
     * every one of 800 writes measurably slows the work it is reporting on.
     */
    let lastPaint = 0;
    const report: ReportProgress = (done, total, label) => {
      const now = performance.now();
      // The last tick always paints, so the counter finishes on "131 / 131" rather than
      // whatever number the throttle happened to let through.
      const final = total != null && total > 0 && done >= total;
      if (!final && now - lastPaint < 100) return;
      lastPaint = now;
      setState((s) => (s ? { ...s, done, total: total ?? s.total, label: label ?? s.label } : s));
    };
    try {
      const result = await work(report);
      setToast({ tone: "success", text: `${message.replace(/[.…]+$/, "")} — done.` });
      return result;
    } catch (e) {
      setToast({ tone: "danger", text: (e as Error).message || "The operation failed." });
      throw e;
    } finally {
      setState(null);
    }
  }, []);

  const pct =
    state?.total && state.total > 0
      ? Math.min(100, Math.round((state.done / state.total) * 100))
      : null;

  return (
    <BusyContext.Provider value={{ run }}>
      {children}

      <dialog
        ref={dialogRef}
        className="busy"
        aria-labelledby="busy-message"
        /*
         * A modal <dialog> closes on Escape by default, firing `cancel` first. Here that would
         * dismiss the only sign that hundreds of writes are still in flight — and leave the page
         * interactive mid-delete. Preventing `cancel` is what actually makes this blocking; the
         * absence of a close button is not enough on its own.
         */
        onCancel={(e) => e.preventDefault()}
      >
        {state && (
          <div className="busy-body">
            <div className="busy-head">
              <span className="spinner" aria-hidden />
              <span className="busy-message" id="busy-message">
                {state.message}
              </span>
            </div>

            {/* Only shown once a total is known — "125 of 0" is worse than no counter. */}
            {state.total != null && state.total > 0 && (
              <>
                <div className="busy-track" role="progressbar" aria-valuenow={pct ?? 0}>
                  <span style={{ width: `${pct ?? 0}%` }} />
                </div>
                <div className="busy-count">
                  {state.done} / {state.total} completed
                  {pct != null ? ` · ${pct}%` : ""}
                  {state.label ? ` · ${state.label}` : ""}
                </div>
              </>
            )}
            {state.total == null && state.label && (
              <div className="busy-count">{state.label}</div>
            )}

            <div className="busy-note">Please wait — do not close this tab.</div>
          </div>
        )}
      </dialog>

      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === "danger" ? "alert" : "status"}>
          {toast.tone === "danger" ? (
            <AlertTriangle size={16} aria-hidden />
          ) : (
            <CheckCircle2 size={16} aria-hidden />
          )}
          <span>{toast.text}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </BusyContext.Provider>
  );
}
