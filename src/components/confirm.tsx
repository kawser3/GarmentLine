/**
 * In-app confirmation dialog, replacing `window.confirm`.
 *
 * The native prompt renders in the browser chrome — it can't be styled, it announces the
 * page origin rather than the app, and on Chrome it grows a "prevent this page from
 * creating additional dialogs" checkbox that can silently disable every later confirm in
 * the session. That last one matters here: the destructive paths (wipe, delete, apply)
 * would then run with no guard at all.
 *
 * Built on the native `<dialog>` element rather than a hand-rolled overlay, which gets us
 * the focus trap, the top layer (no z-index arithmetic against the sidebar), inert
 * background content, and Escape handling from the platform.
 *
 * Usage — the promise makes it a drop-in for the `window.confirm` call sites:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete this line?", tone: "danger" }))) return;
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
import { Button } from "./ui";

export interface ConfirmOptions {
  title: string;
  /** Prose shown under the title. Keep it to what the reader needs to decide. */
  body?: ReactNode;
  /** Rendered as a list under the body — for enumerating what is about to change. */
  bullets?: string[];
  confirmLabel?: string;
  /** `null` drops the cancel button, turning the dialog into a plain acknowledgement. */
  cancelLabel?: string | null;
  /** `danger` paints the confirm button red. Use it for anything that destroys data. */
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm needs a <ConfirmProvider> above it");
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  /*
   * The resolver lives in a ref, not in state, so `settle` is idempotent. Closing the
   * dialog fires `close`, which settles as a cancel — that must be a no-op when a button
   * already settled it, or a confirmed action would resolve twice with opposite answers.
   */
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(ok);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second confirm while one is open cancels the first rather than losing its promise.
      pending.current?.(false);
      pending.current = resolve;
      setOptions(next);
    });
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (options && !el.open) {
      el.showModal();
      // Focus the affirmative button so Enter works, but not for destructive actions —
      // there the default should be to do nothing.
      if (options.tone !== "danger") confirmBtnRef.current?.focus();
    } else if (!options && el.open) {
      el.close();
    }
  }, [options]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className="confirm"
        aria-labelledby="confirm-title"
        onClose={() => settle(false)}
        onCancel={() => settle(false)}
        onClick={(e) => {
          // Clicks on the backdrop are reported against the dialog itself.
          if (e.target === dialogRef.current) settle(false);
        }}
      >
        {options && (
          <>
            <div className="confirm-head">
              <h2 className="confirm-title" id="confirm-title">
                {options.title}
              </h2>
            </div>
            {(options.body || options.bullets?.length) && (
              <div className="confirm-body">
                {options.body && <div className="confirm-text">{options.body}</div>}
                {options.bullets?.length ? (
                  <ul className="confirm-list">
                    {options.bullets.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
            <div className="confirm-foot">
              {options.cancelLabel !== null && (
                <Button onClick={() => settle(false)}>{options.cancelLabel ?? "Cancel"}</Button>
              )}
              <Button
                ref={confirmBtnRef}
                variant={options.tone === "danger" ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
