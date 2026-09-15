import type {
  ComponentPropsWithRef,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cx } from "@/lib/utils";

/* ------------------------------------------------------------------ controls */

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: "default" | "primary" | "danger" | "quiet";
  size?: "sm" | "md" | "block";
}) {
  return (
    <button
      className={cx(
        "btn",
        variant !== "default" && variant,
        size === "sm" && "sm",
        size === "block" && "block",
        className,
      )}
      {...props}
    />
  );
}

/** Segmented control, for mutually exclusive view/range choices. */
export function ButtonGroup({ children }: { children: ReactNode }) {
  return <div className="btn-group">{children}</div>;
}

export function Input({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<"input">) {
  // Money and quantities get tabular figures and right alignment so a column reads
  // as a column. Everything else stays in the UI sans.
  const numeric = props.type === "number";
  // React 19 passes `ref` as a normal prop, so no forwardRef is needed — but it still has to
  // be threaded through explicitly or a caller that focuses the field silently gets nothing.
  return <input ref={ref} className={cx("input", numeric && "amount", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("select", className)} {...props} />;
}

/**
 * A labelled control. `required` renders a red asterisk rather than baking a `*` into the
 * label text — the mark is presentation, not part of the field's name.
 */
export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/* -------------------------------------------------------------- containers */

export function Card({
  title,
  sub,
  actions,
  span,
  tight,
  children,
}: {
  title?: string;
  sub?: string;
  actions?: ReactNode;
  span?: boolean;
  tight?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="card" style={span ? { gridColumn: "1 / -1" } : undefined}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {sub && <span className="card-sub">{sub}</span>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children && <div className={cx("card-body", tight && "tight")}>{children}</div>}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={cx("stat-value", tone)}>{value}</div>
      {/*
        Always rendered, even with no hint. The element reserves its line height, so a row of
        stats stays the same height whether or not each one has something to say underneath —
        previously the card without a hint was visibly shorter than its neighbours.
      */}
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "danger" | "info";
}) {
  return <span className={cx("badge", tone)}>{children}</span>;
}

/* ------------------------------------------------------------------- states */

export function Empty({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {title && <div className="empty-title">{title}</div>}
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty">
      <span className="spinner" style={{ marginRight: 8 }} />
      {label}
    </div>
  );
}

const ALERT_ICON = {
  danger: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
} as const;

/** Status is carried by an icon and a title, never by colour alone. */
export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "danger" | "success" | "warning" | "info";
  title?: string;
  children?: ReactNode;
}) {
  const Icon = ALERT_ICON[tone];
  return (
    <div className={cx("alert", tone)} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={17} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="detail">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  const notAuthed = /not authenticated|AUTH_NOT_AUTHENTICATED|401/i.test(msg);
  return (
    <Alert tone="danger" title="Request failed">
      {msg}
      {notAuthed && (
        <div style={{ marginTop: 6 }}>
          This data requires a signed-in session. If you are signed in, your session has
          most likely expired — sign in again.
        </div>
      )}
    </Alert>
  );
}

/* -------------------------------------------------------------------- table */

/**
 * `fill` makes the table stretch to its container's full height, so a `tfoot` total lands at
 * the bottom of the card instead of directly under the last data row. Pair it with
 * `<TableFiller>` as the final row of the tbody — that row absorbs the slack, which is what
 * keeps the data rows at their natural height and opens the gap above the total.
 */
export function TableWrap({
  children,
  fill,
  variant,
}: {
  children: ReactNode;
  fill?: boolean;
  /** Extra class on the <table>, for column rules that must not reach every table. */
  variant?: string;
}) {
  return (
    <div className={cx("table-wrap", fill && "fill")}>
      <table className={cx("table", variant)}>{children}</table>
    </div>
  );
}

/**
 * An empty row that eats leftover vertical space, pushing a `tfoot` to the bottom of the card.
 *
 * A table cannot be a flex child and keep its column alignment, so the usual flex trick is out.
 * Stretching the table itself (`height: 100%`) instead distributes the extra height across
 * every row, which makes short tables look padded out. A single `height: 100%` filler row takes
 * all of it and leaves the real rows alone. It collapses to nothing when the table already
 * overflows, so it costs nothing in the long case.
 */
export function TableFiller({ cols }: { cols: number }) {
  return (
    <tr className="table-filler" aria-hidden>
      <td colSpan={cols} />
    </tr>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="table-actions">{children}</div>;
}

/** Proportion bar. Width carries the magnitude; the adjacent figure carries the value. */
export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(1, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="bar-track">
      <span
        style={{ width: `${pct}%`, background: value < 0 ? "var(--danger)" : undefined }}
      />
    </div>
  );
}
