/**
 * Config-driven CRUD for the admin tables.
 *
 * Lifted from the reference project's master-data page, unchanged apart from being extracted
 * into its own module. Every admin collection here is the same shape — a short flat list a
 * person maintains by hand — so one component covers nine tables rather than nine
 * near-identical files.
 *
 * Behaviour worth knowing before adding a page:
 *
 *  - **Status is not editable inline.** Tick rows and use the selection bar's
 *    Activate/Deactivate, so there is exactly one mechanism for it across every table.
 *  - **`unique` is checked client-side**, against the list already on screen. The gateway has
 *    no documented uniqueness constraint, and marking several fields unique makes the
 *    COMBINATION unique rather than each one.
 *  - **Deletes are soft** and go through the confirm dialog. Rows referencing a deleted
 *    record render "Deleted" rather than a raw identifier.
 *  - **Sorting always ends on ItemId.** The gateway's row order is not stable between
 *    fetches, so equal-comparing rows would otherwise swap places after a mutation and make
 *    an edit look as though it hit a different record.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Download, Lock, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { TableToolbar, useRowFilter, FilterCount, type FilterDef } from "@/components/table-toolbar";
import { BulkActionBar, type BulkAction } from "@/components/bulk-actions";
import { useRowSelection, SelectAllHeader, SelectCell } from "@/components/row-selection";
import { useConfirm } from "@/components/confirm";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Loading,
  RowActions,
  Select,
  TableWrap,
} from "@/components/ui";
import { cx } from "@/lib/utils";
import { downloadCsv, exportName } from "@/lib/export";
import type { CrudApi, SystemFields } from "@/features/data/make-crud";
import { useT } from "@/features/i18n/i18n";
import type { DictKey } from "@/features/i18n/dictionary";

/* ------------------------------------------------------------------ field spec */

/**
 * `refs` is a MULTI-value reference — an array of ids on the record.
 *
 * The incident model leans on these: a client serves several units and consumes
 * several applications, a third-party service is watched on several components
 * and linked to several applications. Storing them as arrays is what lets one
 * incident span three units without a copy per unit, so the master screens have
 * to be able to maintain them.
 *
 * `tags` is the same control over free text rather than ids — WatchedComponents
 * is a list of provider component names, not references to anything we hold.
 */
/**
 * `endpoint` is a generated, read-only URL — the webhook a provider posts to.
 *
 * It is not something a person types: it is derived from the project key, the
 * workflow id and the webhook id, and it only exists once the adapter workflow
 * has been published. So the cell shows it with a copy button rather than an
 * input, and says plainly when there is not one yet.
 */
export type FieldType = "text" | "number" | "boolean" | "ref" | "refs" | "tags" | "endpoint";

export interface FieldSpec<T> {
  key: keyof T & string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
  placeholder?: string;
  hint?: string;
  /**
   * If set, the value is checked for duplicates against existing rows before insert/update.
   * Comparison is trimmed and case-folded. The edit path excludes the row being edited.
   * Only meaningful on text fields; ignored otherwise.
   */
  unique?: boolean;
  /**
   * Settable when a row is created, read-only afterwards.
   *
   * For the SYSTEM KEY of a record — a feature's slug, a setting's key. The application looks
   * these up by value, so editing one silently detaches the record from whatever reads it: a
   * renamed setting key makes its page fall back to a built-in default, and a renamed feature
   * slug breaks every shared calculator link already sent out.
   *
   * Previously this was a warning asking administrators not to do it, which put the burden of
   * remembering on the person least able to see the consequence. Locking the field removes the
   * question.
   */
  lockedOnEdit?: boolean;
  /**
   * For `endpoint` fields, on the CREATE path only: the value the new row should carry.
   *
   * The webhook URL is not typed by a person, but it should not wait for a script either —
   * adding a monitoring source is the moment someone wants to paste the URL into the
   * provider. The page supplies a generator that reads it off the already-published row;
   * still never written on edit, where the workflow owns the value.
   */
  /** Receives the form draft so a generated value can follow another field (e.g. the provider). */
  generate?: (draft?: Record<string, unknown>) => string | undefined;
}

/**
 * Config-driven CRUD for the master collections. They are all the same shape — a short flat
 * list maintained by hand — so one component covers all six rather than six near-identical
 * files.
 */
/** Generated fields are displayed but never written back. */
const isReadOnly = (spec: { type: FieldType }) => spec.type === "endpoint";

export function MasterTable<T extends SystemFields & { IsActive?: boolean | null }, I, U>({
  crud,
  fields,
  sortBy,
  entity,
  entityPlural,
  entityKey,
  afterCreate,
}: {
  crud: CrudApi<T, I, U>;
  fields: Array<FieldSpec<T>>;
  sortBy?: (a: T, b: T) => number;
  entity: string;
  entityPlural: string;
  /**
   * Selects the dictionary noun pair for this table. Display sentences resolve through
   * `master.entity.<key>.one/.many`; the raw `entity`/`entityPlural` props keep feeding
   * the CSV export filename (`exportName`) and BulkActionBar's own wording, which are
   * not this file's to translate.
   */
  entityKey?: "unit" | "application" | "client" | "slaPolicy" | "monitoringSource" | "thirdParty";
  /**
   * Runs after a successful insert, with the new row's id. Return a message to show
   * as a form error; return nothing when it succeeded. The row already exists either
   * way — this is a follow-up, not part of the insert.
   */
  afterCreate?: (
    itemId: string,
    payload: Record<string, unknown>,
  ) => Promise<string | undefined | void>;
}) {
  const t = useT();
  /*
   * Display noun for sentences: the dictionary pair when the table declares one, the raw
   * English props otherwise (tables without keys must keep working unchanged). The cast is
   * safe because every `master.entity.<entityKey>.*` combination in the union above exists
   * in the dictionary — the type cannot express template-literal keys.
   */
  const ent = (k: "one" | "many") =>
    entityKey
      ? t(`master.entity.${entityKey}.${k}` as DictKey)
      : k === "one"
        ? entity
        : entityPlural;

  const list = crud.useAll();
  const create = crud.useCreate();
  const update = crud.useUpdate();
  const remove = crud.useDelete();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const items = [...(list.data ?? [])];
    /*
     * Always finish on ItemId. The gateway's row order is not stable between fetches and
     * Array.sort is stable, so equal-comparing rows would otherwise keep their arrival
     * order and could swap places after a mutation — making it look as though an edit or
     * delete hit a different record. See the sorting note in make-crud.ts.
     */
    return items.sort(
      (a, b) => (sortBy ? sortBy(a, b) : 0) || a.ItemId.localeCompare(b.ItemId),
    );
  }, [list.data, sortBy]);

  /*
   * Search matches the resolved text of every field — the same strings `display()` shows —
   * so a search for a wing name or unit name finds the rows that reference it. Ref fields
   * resolve through their option list (mirrors display/exportCsv); booleans become
   * Active/Inactive; everything else is the raw value.
   */
  const rowText = (row: T) =>
    fields
      .map((spec) => {
        const v = row[spec.key] as unknown;
        if (spec.type === "boolean") return v === false ? t("common.inactive") : t("common.active");
        if (spec.type === "ref") {
          if (!v) return "";
          // Translated to match display(): a reader who sees "Gelöscht" must be able to
          // type it into the search box and find the row.
          return (spec.options ?? []).find((o) => o.id === v)?.label ?? t("common.deleted");
        }
        if (spec.type === "refs") {
          return ((v as string[]) ?? [])
            .map((id) => (spec.options ?? []).find((o) => o.id === id)?.label ?? "")
            .join(" ");
        }
        if (spec.type === "tags") return ((v as string[]) ?? []).join(" ");
        return v == null ? "" : String(v);
      })
      .join(" ");

  /*
   * Filter dropdowns for ref and boolean columns. Text/number columns are covered by the search
   * box, and a select of every distinct string value would be unwieldy.
   *
   * Booleans are included because Status is what the bulk actions write, and "filter to Inactive,
   * select all, Activate" is the flow that makes them worth having.
   */
  const booleanFilters: FilterDef[] = fields
    .filter((spec) => spec.type === "boolean")
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      options: [
        { value: "active", label: t("common.active") },
        { value: "inactive", label: t("common.inactive") },
      ],
    }));

  const refFilters: FilterDef[] = fields
    .filter((spec): spec is FieldSpec<T> & { type: "ref" } => spec.type === "ref")
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      options: (spec.options ?? []).map((o) => ({ value: o.id, label: o.label })),
    }));

  const filterDefs: FilterDef[] = [...refFilters, ...booleanFilters];

  /** Field keys whose filter value is the Active/Inactive pair rather than a raw id. */
  const booleanKeys = new Set(booleanFilters.map((d) => d.key));

  const flt = useRowFilter(rows, {
    getText: rowText,
    filters: filterDefs,
    getFilterValue: (row: T, key) => {
      const v = (row as Record<string, unknown>)[key];
      // Booleans are matched as the strings the dropdown offers; null counts as active, the
      // same way every other read of IsActive in the app treats a missing value.
      if (booleanKeys.has(key)) return v === false ? "inactive" : "active";
      return (v as string | null | undefined) ?? "";
    },
  });

  const sel = useRowSelection(flt.rows);
  const invalidate = crud.useInvalidate();

  /*
   * Activate / Deactivate are only offered when the table actually shows a Status column. Every
   * master schema carries IsActive, but a table that does not display it would be changing a
   * field the reader cannot see — so the capability follows the column, not the schema.
   */
  const hasStatus = fields.some((spec) => spec.key === "IsActive" && spec.type === "boolean");
  const rowLabel = (row: T) => String((row as Record<string, unknown>).Name ?? row.ItemId);

  const bulkActions: BulkAction<T>[] = [
    ...(hasStatus
      ? ([
          {
            key: "activate",
            label: t("master.activate"),
            verb: "activate",
            icon: <CheckCircle2 size={13} aria-hidden />,
            applies: (row: T) => row.IsActive === false,
            run: (row: T) => crud.updateOne(row.ItemId, { IsActive: true } as unknown as U),
          },
          {
            key: "deactivate",
            label: t("master.deactivate"),
            verb: "deactivate",
            icon: <XCircle size={13} aria-hidden />,
            applies: (row: T) => row.IsActive !== false,
            note: t("master.deactivateNote", { plural: ent("many") }),
            run: (row: T) => crud.updateOne(row.ItemId, { IsActive: false } as unknown as U),
          },
        ] as BulkAction<T>[])
      : []),
    {
      key: "delete",
      label: t("master.deleteLabel"),
      verb: "delete",
      verbPast: "deleted",
      tone: "danger",
      icon: <Trash2 size={13} aria-hidden />,
      note: t("master.deleteNote", { plural: ent("many") }),
      run: (row: T) => crud.deleteOne(row.ItemId),
    },
  ];

  function coerce(spec: FieldSpec<T>, raw: unknown) {
    if (spec.type === "number") {
      if (raw === "" || raw == null) return null;
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    }
    if (spec.type === "boolean") return Boolean(raw);
    if (raw === "") return null;
    return raw;
  }

  function build(source: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    // Generated fields are shown but never written back — sending a stale copy
    // of a URL the workflow owns would overwrite the real one with whatever the
    // form happened to be holding.
    for (const f of fields) {
      if (isReadOnly(f)) continue;
      out[f.key] = coerce(f, source[f.key]);
    }
    return out;
  }

  /*
   * Duplicate check: when any fields are marked `unique`, the COMBINATION of their values
   * must be unique against existing rows. Comparison is trimmed and case-folded, so "ACME"
   * and " acme " collide on either field. On edit, the row being edited is excluded —
   * otherwise saving without changing the values would always fail.
   *
   * Use case: a project named "Blocks" can exist under two different business units. With
   * `unique` on `Name` alone, the second one was blocked; with `unique` on both `Name`
   * and `Code`, the pair (Name, Code) is what must not collide, which lets two distinct
   * (name, code) combinations coexist.
   *
   * Server-side this is not enforceable on the gateway (introspection is disabled and
   * there is no documented uniqueness constraint), so the check happens here, on the same
   * list the UI is rendering, which is good enough at master-table scale.
   */
  function duplicate(source: Record<string, unknown>, excludeItemId?: string) {
    const items = list.data ?? [];
    const uniqueKeys = fields.filter((f) => f.unique).map((f) => f.key as string);
    if (uniqueKeys.length === 0) return null;

    const norm = (v: unknown) =>
      typeof v === "string" ? v.trim().toLowerCase() : v == null ? "" : String(v);

    const sourceSig = uniqueKeys.map((k) => norm(source[k])).join("");
    if (uniqueKeys.every((k) => !norm(source[k]))) return null;

    const hit = items.find(
      (r) =>
        r.ItemId !== excludeItemId &&
        uniqueKeys
          .map((k) => norm((r as Record<string, unknown>)[k]))
          .join("") === sourceSig,
    );
    if (hit) {
      // Field labels arrive already translated from the page, so the description
      // language follows the active locale on its own.
      const desc = uniqueKeys
        .map((k) => {
          const v = (source as Record<string, unknown>)[k];
          const label = fields.find((f) => f.key === k)?.label ?? k;
          return `${label}: "${typeof v === "string" ? v.trim() : v}"`;
        })
        .join(", ");
      return t("master.sameExists", { entity: ent("one"), desc });
    }
    return null;
  }

  function validate(source: Record<string, unknown>) {
    for (const f of fields) {
      if (f.required && !source[f.key]) return t("master.fieldRequired", { label: f.label });
    }
    return null;
  }

  async function submitNew() {
    const err = validate(draft) ?? duplicate(draft);
    setFormError(err);
    if (err) return;
    const payload = build(draft) as I;
    // Generated fields join the INSERT only — on edit, `build` still drops them, because
    // the workflow that owns the URL may have republished between edits.
    for (const f of fields) {
      if (isReadOnly(f) && f.generate) {
        const generated = f.generate(draft as Record<string, unknown>);
        if (generated) (payload as Record<string, unknown>)[f.key] = generated;
      }
    }
    if (fields.some((f) => f.key === "IsActive") && draft.IsActive === undefined) {
      (payload as Record<string, unknown>).IsActive = true;
    }
    const res = await create.mutateAsync(payload);
    if (!res.acknowledged) {
      setFormError(res.message ?? t("master.insertNotAcknowledged"));
      return;
    }
    /*
     * A follow-up write the new row needs but cannot express as a field — currently
     * only claiming a webhook slot. It runs AFTER the insert is acknowledged, because
     * it needs the new row's id, and its failure is reported without rolling the
     * insert back: the row is valid without a slot and the form says what is missing,
     * which is better than discarding what the person just typed.
     */
    if (afterCreate && res.itemId) {
      const problem = await afterCreate(res.itemId, payload as Record<string, unknown>);
      if (problem) {
        setFormError(problem);
        setDraft({});
        setShowAdd(false);
        return;
      }
    }
    setDraft({});
    setShowAdd(false);
  }

  async function submitEdit(row: T) {
    const merged = { ...row, ...editDraft } as Record<string, unknown>;
    const err = validate(merged) ?? duplicate(merged, row.ItemId);
    setFormError(err);
    if (err) return;
    await update.mutateAsync({
      where: { ItemId: { eq: row.ItemId } },
      input: build(merged) as U,
    });
    setEditing(null);
    setEditDraft({});
  }

  function renderInput(
    spec: FieldSpec<T>,
    value: unknown,
    onChange: (v: unknown) => void,
    locked = false,
  ) {
    // A system key is shown as the value it is, not as a disabled input: a greyed-out box still
    // invites a click, and there is nothing to type.
    if (locked) {
      return (
        <span className="locked-value">
          <code>{(value as string) || "—"}</code>
          <Lock size={12} aria-hidden />
        </span>
      );
    }
    /*
     * Status is READ-ONLY in the row editor. It is changed from the selection bar — tick the
     * rows, then Activate/Deactivate — so that there is exactly one mechanism for it across all
     * eleven tables rather than an inline select here and a bulk action there.
     *
     * `submitEdit` merges `{...row, ...editDraft}`, so a status the editor never writes is
     * carried through from the row unchanged rather than being dropped.
     */
    if (spec.type === "boolean") {
      return (
        <Badge tone={value === false ? undefined : "success"}>
          {value === false ? t("common.inactive") : t("common.active")}
        </Badge>
      );
    }
    if (spec.type === "ref") {
      return (
        <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("common.none")}</option>
          {(spec.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    /*
     * A checklist rather than a <select multiple>: multi-selects need a modifier key
     * nobody discovers, and silently drop every other choice when one is clicked
     * without it. On a screen where losing a unit means an incident stops reaching
     * a dashboard, that failure is too quiet.
     */
    if (spec.type === "refs") {
      const chosen = new Set((value as string[]) ?? []);
      return (
        <div className="checklist">
          {(spec.options ?? []).map((o) => (
            <label key={o.id} className="checklist-item">
              <input
                type="checkbox"
                checked={chosen.has(o.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(o.id);
                  else next.delete(o.id);
                  onChange([...next]);
                }}
              />
              {o.label}
            </label>
          ))}
          {!(spec.options ?? []).length && <span className="subtle">{t("master.nothingToChoose")}</span>}
        </div>
      );
    }
    if (spec.type === "endpoint") {
      // In the add form `value` is empty and the generator supplies it, so the person
      // sees — and can copy — the URL the new row will carry before saving it.
      const url = String(value ?? spec.generate?.(draft as Record<string, unknown>) ?? "");
      return (
        <div className="endpoint-cell">
          {url ? (
            <>
              <code>{url}</code>
              <button
                type="button"
                className="btn sm quiet"
                onClick={() => void navigator.clipboard?.writeText(url)}
                title={t("common.copyFullUrl")}
              >
                {t("common.copy")}
              </button>
            </>
          ) : (
            <span className="subtle">{t("master.hint.endpointPending")}</span>
          )}
        </div>
      );
    }
    if (spec.type === "tags") {
      return (
        <Input
          value={((value as string[]) ?? []).join(", ")}
          placeholder={spec.placeholder}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      );
    }
    return (
      <Input
        type={spec.type === "number" ? "number" : "text"}
        value={(value as string | number | undefined) ?? ""}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  function display(spec: FieldSpec<T>, row: T) {
    const v = row[spec.key] as unknown;
    if (spec.type === "boolean") {
      return v === false ? <Badge>Inactive</Badge> : <Badge tone="success">Active</Badge>;
    }
    if (spec.type === "ref") {
      if (!v) return <span className="subtle">—</span>;
      const hit = (spec.options ?? []).find((o) => o.id === v);
      // A dangling reference means the target was deleted — say so rather than showing a
      // raw identifier nobody can interpret.
      return hit ? (
        <>{hit.label}</>
      ) : (
        <span className="neg" title={String(v)}>
          {t("common.deleted")}
        </span>
      );
    }
    if (spec.type === "endpoint") {
      const url = String(v ?? "");
      if (!url) {
        return (
          <span className="subtle" title={t("master.endpointPublishHint")}>
            {t("master.endpointNotGenerated")}
          </span>
        );
      }
      return (
        <span className="endpoint-cell">
          <code title={url}>{url.replace(/^https?:\/\/[^/]+/, "…")}</code>
          <button
            type="button"
            className="btn sm quiet"
            onClick={() => void navigator.clipboard?.writeText(url)}
            title="Copy the full URL"
          >
            Copy
          </button>
        </span>
      );
    }
    if (spec.type === "refs" || spec.type === "tags") {
      const list = (v as string[]) ?? [];
      if (!list.length) return <span className="subtle">—</span>;
      const labels =
        spec.type === "tags"
          ? list
          : list.map((id) => (spec.options ?? []).find((o) => o.id === id)?.label ?? t("common.deleted"));
      // Long lists would push the row's other columns out of view, so past three the
      // cell states the count and carries the rest in its tooltip.
      const shown = labels.slice(0, 3).join(", ");
      return (
        <span title={labels.join(", ")}>
          {shown}
          {labels.length > 3 ? ` +${labels.length - 3}` : ""}
        </span>
      );
    }
    if (v == null || v === "") return <span className="subtle">—</span>;
    return <>{String(v)}</>;
  }

  function exportCsv() {
    downloadCsv(exportName(entityPlural, "all"), rows, [
      ...fields.map((f) => ({
        header: f.label,
        value: (r: T) => {
          const v = r[f.key] as unknown;
          if (f.type === "boolean") return v === false ? "Inactive" : "Active";
          if (f.type === "ref") {
            return (f.options ?? []).find((o) => o.id === v)?.label ?? "";
          }
          if (f.type === "refs") {
            return ((v as string[]) ?? [])
              .map((id) => (f.options ?? []).find((o) => o.id === id)?.label ?? "")
              .join("; ");
          }
          if (f.type === "tags") return ((v as string[]) ?? []).join("; ");
          return (v as string | number | null) ?? "";
        },
      })),
    ]);
  }

  const busy = create.isPending || update.isPending || remove.isPending;
  const mutErr = create.error ?? update.error ?? remove.error;

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-spacer" />
        <Button onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={15} aria-hidden />
          {t("common.exportCsv")}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            // Leaving a row in inline-edit mode while the Add form opens invites saving
            // the wrong one; close the edit first.
            setEditing(null);
            setEditDraft({});
            setFormError(null);
            setShowAdd((v) => !v);
          }}
        >
          <Plus size={15} aria-hidden />
          {t("master.add", { entity: ent("one") })}
        </Button>
      </div>

      {mutErr && <ErrorAlert error={mutErr} />}

      <div className="grid one">
        {showAdd && (
          <Card
            title={t("master.add", { entity: ent("one") })}
            actions={
              <Button variant="quiet" onClick={() => setShowAdd(false)}>
                {t("detail.cancel")}
              </Button>
            }
          >
            <div className="form-grid">
              {fields
                .filter((f) => f.key !== "IsActive")
                .map((f) => (
                  <Field key={f.key} label={f.label} hint={f.hint} required={f.required}>
                    {renderInput(f, draft[f.key], (v) =>
                      setDraft((d) => ({ ...d, [f.key]: v })),
                    )}
                  </Field>
                ))}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <Button variant="primary" disabled={busy} onClick={() => void submitNew()}>
                {create.isPending ? t("master.saving") : t("master.add", { entity: ent("one") })}
              </Button>
              {formError && <span className="neg" style={{ fontSize: 13 }}>{formError}</span>}
            </div>
          </Card>
        )}

        <Card
          /*
           * The translated many-form is used verbatim — German nouns arrive capitalised,
           * so the charAt(0).toUpperCase() hack is only needed on the raw-English path,
           * where it would also mangle a hyphenated plural like "sla-policies" if applied
           * to nothing but the first letter.
           */
          title={entityKey ? ent("many") : entityPlural.charAt(0).toUpperCase() + entityPlural.slice(1)}
          sub={
            rows.length === 1
              ? t("master.records.one", { n: rows.length })
              : t("master.records.many", { n: rows.length })
          }
          actions={<FilterCount filter={flt} total={rows.length} />}
          tight
          span
        >
          {list.isPending ? (
            <Loading />
          ) : list.error ? (
            <div style={{ padding: 18 }}>
              <ErrorAlert error={list.error} />
            </div>
          ) : rows.length === 0 ? (
            <Empty title={t("master.noYet", { plural: ent("many") })}>
              {t("master.emptyBody")}
            </Empty>
          ) : (
            <>
            <TableToolbar filter={flt} filters={filterDefs} />
            <BulkActionBar
              selection={sel}
              actions={bulkActions}
              entity={entity}
              onDone={invalidate}
            />
            <TableWrap>
              <thead>
                <tr>
                  <SelectAllHeader selection={sel} />
                  {fields.map((f) => (
                    <th key={f.key} className={f.type === "number" ? "amount" : undefined}>
                      {f.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {flt.rows.map((row) => {
                  const isEditing = editing === row.ItemId;
                  return (
                    <tr
                      key={row.ItemId}
                      className={cx(
                        row.IsActive === false && "dimmed",
                        sel.isSelected(row.ItemId) && "selected",
                      )}
                    >
                      <SelectCell selection={sel} row={row} label={rowLabel(row)} />
                      {fields.map((f) => (
                        <td key={f.key} className={f.type === "number" ? "amount" : undefined}>
                          {isEditing
                            ? renderInput(
                                f,
                                (editDraft[f.key] ?? row[f.key]) as unknown,
                                (v) => setEditDraft((d) => ({ ...d, [f.key]: v })),
                                f.lockedOnEdit,
                              )
                            : display(f, row)}
                        </td>
                      ))}
                      <td>
                        <RowActions>
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={busy}
                                onClick={() => void submitEdit(row)}
                              >
                                {t("detail.save")}
                              </Button>
                              <Button
                                size="sm"
                                variant="quiet"
                                onClick={() => {
                                  setEditing(null);
                                  setEditDraft({});
                                  setFormError(null);
                                }}
                              >
                                {t("detail.cancel")}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setEditing(row.ItemId);
                                  setEditDraft({});
                                  setFormError(null);
                                  setShowAdd(false);
                                }}
                              >
                                <Pencil size={13} aria-hidden />
                                {t("detail.edit")}
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={busy}
                                onClick={() => {
                                  const label =
                                    (row as Record<string, unknown>).Name ?? row.ItemId;
                                  void (async () => {
                                    const ok = await confirm({
                                      title: t("master.deleteOneTitle", { label: String(label) }),
                                      body: t("master.deleteOneBody"),
                                      confirmLabel: t("master.deleteLabel"),
                                      tone: "danger",
                                    });
                                    if (ok) await remove.mutateAsync({ ItemId: { eq: row.ItemId } });
                                  })();
                                }}
                              >
                                <Trash2 size={13} aria-hidden />
                                {t("master.deleteLabel")}
                              </Button>
                            </>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
