/**
 * A general-purpose modal, on the same native `<dialog>` foundation as the confirm
 * dialog — top layer, focus trap, inert background, Escape handling all come from
 * the platform rather than being re-implemented and re-broken here.
 *
 * The confirm dialog answers a yes/no question; this one holds content — a form, a
 * preview — which is what the incident page needed when its inline editors began
 * competing for space instead of editing.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";

export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  // Content width. Set per use — a report preview and a reason field should not
  // share a size, and a variant class per size is the same number with more names.
  width = 520,
  // The report preview wants its iframe flush to the dialog edges; everything
  // else wants the padding the rest of the app uses.
  pad = true,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  pad?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /*
   * Escape: prevent the native close and route through onClose, so the parent's
   * state is what removes the dialog — otherwise the element would close itself
   * and then be closed again a frame later when the state catches up.
   */
  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicks on the backdrop are reported against the dialog element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 className="modal-title" id="modal-title">
            {title}
          </h2>
          {sub && <div className="modal-sub">{sub}</div>}
        </div>
        <Button size="sm" variant="quiet" aria-label="Close" onClick={onClose}>
          <X size={15} aria-hidden />
        </Button>
      </div>
      <div className={pad ? "modal-body" : "modal-body flush"}>{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}
