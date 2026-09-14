import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, ErrorAlert, Field, Loading } from "@/components/ui";
import { PageHead } from "@/components/layout";
import {
  DEPARTMENTS, ISSUE_TYPES, SEVERITIES,
  buyers, issues as issuesCrud, linesCrud, stylesCrud,
  type Department, type IssueType, type Severity,
} from "@/features/data/garment-schemas";
import { repeatMessage, REPEAT_WINDOW_DAYS, useRaiseIssue } from "@/features/issues/raise";
import { canRaiseIssue, useAuthStore } from "@/stores/auth";
import { useT } from "@/features/i18n/i18n";

/**
 * Raise a production issue by hand.
 *
 * The AI path (buyer comment → proposed actions → accept) ends here too — both
 * roads run through useRaiseIssue, which is where the repeat-defect window is
 * checked. Whatever raised it, the second occurrence of a defect type on one
 * line inside the window alerts the GM before a third can land.
 */
export function RaiseIssuePage() {
  const user = useAuthStore((s) => s.user);
  const t = useT();
  const navigate = useNavigate();
  const { raise, pending } = useRaiseIssue();

  const styles = stylesCrud.useAll();
  const lines = linesCrud.useAll();
  const buyerList = buyers.useAll();
  const allIssues = issuesCrud.useAll();

  const [form, setForm] = useState({
    Title: "", Description: "", Type: "Shade" as IssueType, Severity: "High" as Severity,
    StyleId: "", LineId: "", Department: "Sewing" as Department, OwnerName: "", DueDate: "",
  });
  const [failure, setFailure] = useState<unknown>(null);
  const [repeatNote, setRepeatNote] = useState<string | null>(null);

  if (styles.isPending || lines.isPending) return <Loading label="Loading the raise form…" />;

  const styleRows = styles.data ?? [];
  const lineRows = lines.data ?? [];
  const buyerOf = (styleId: string) =>
    (buyerList.data ?? []).find((b) => b.ItemId === styleRows.find((s) => s.ItemId === styleId)?.BuyerId);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setFailure(null);
    if (!form.Title.trim() || !form.StyleId || !form.LineId) {
      setFailure(new Error("Title, style and line are required."));
      return;
    }
    const style = styleRows.find((s) => s.ItemId === form.StyleId);
    const buyer = buyerOf(form.StyleId);
    try {
      const { issueId, repeat } = await raise({
        Title: form.Title.trim(),
        Description: form.Description.trim(),
        Type: form.Type,
        Severity: form.Severity,
        StyleId: form.StyleId,
        LineId: form.LineId,
        BuyerId: style?.BuyerId ?? buyer?.ItemId ?? "",
        OwnerId: user?.itemId ?? "",
        OwnerName: form.OwnerName.trim() || (user ? `${user.firstName} ${user.lastName}`.trim() : ""),
        Department: form.Department,
        DueDate: form.DueDate ? new Date(form.DueDate).toISOString() : undefined,
      });
      if (repeat) {
        /* Stay and say it: the third-occurrence warning is the point of the demo,
         * and a redirect would swallow it. From here the link goes to the issue. */
        setRepeatNote(
          `${repeatMessage(form.Type, repeat.occurrences, REPEAT_WINDOW_DAYS)} ` +
            `The factory manager has been notified.`,
        );
        setForm((f) => ({ ...f, Title: "", Description: "" }));
      } else {
        navigate(`/issues/${issueId}`);
      }
    } catch (e) {
      setFailure(e);
    }
  }

  const mayRaise = canRaiseIssue(user);
  void allIssues; /* the hook already reads the issue set for the window check */

  return (
    <>
      <PageHead
        title={t("raise.title")}
        description={t("raise.desc")}
      />
      {!mayRaise && (
        <Alert tone="warning" title={t("raise.deniedTitle")}>
          {t("raise.deniedBody")}
        </Alert>
      )}
      <div className="grid one">
        <Card title={t("raise.card")} sub={t("raise.cardSub")}>
          {failure ? <ErrorAlert error={failure} /> : null}
          {repeatNote && (
            <Alert tone="warning" title={t("raise.repeatTitle")}>
              {repeatNote} <Link to="/dashboard">{t("raise.seeAlerts")}</Link>
            </Alert>
          )}
          <div className="stack">
            <Field label={t("col.issue")} required>
              <input
                className="input" value={form.Title}
                onChange={(e) => set("Title", e.target.value)}
                placeholder="e.g. Shade variation, front panel"
                disabled={!mayRaise || pending}
              />
            </Field>
            <Field label={t("raise.description")}>
              <textarea
                className="input" rows={3} value={form.Description}
                onChange={(e) => set("Description", e.target.value)}
                placeholder="What was seen, where, how many pieces."
                disabled={!mayRaise || pending}
              />
            </Field>
            <div className="grid-2">
              <Field label={t("col.type")} required>
                <select className="input" value={form.Type} onChange={(e) => set("Type", e.target.value as IssueType)} disabled={!mayRaise || pending}>
                  {ISSUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t("col.severity")} required>
                <select className="input" value={form.Severity} onChange={(e) => set("Severity", e.target.value as Severity)} disabled={!mayRaise || pending}>
                  {SEVERITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t("col.style")} required>
                <select className="input" value={form.StyleId} onChange={(e) => set("StyleId", e.target.value)} disabled={!mayRaise || pending}>
                  <option value="">—</option>
                  {styleRows.map((s) => <option key={s.ItemId} value={s.ItemId}>{s.StyleCode} — {s.Name}</option>)}
                </select>
              </Field>
              <Field label={t("col.line")} required>
                <select className="input" value={form.LineId} onChange={(e) => set("LineId", e.target.value)} disabled={!mayRaise || pending}>
                  <option value="">—</option>
                  {lineRows.map((l) => <option key={l.ItemId} value={l.ItemId}>{l.Name}</option>)}
                </select>
              </Field>
              <Field label={t("raise.department")} required>
                <select className="input" value={form.Department} onChange={(e) => set("Department", e.target.value as Department)} disabled={!mayRaise || pending}>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label={t("col.due")}>
                <input type="date" className="input" value={form.DueDate}
                  onChange={(e) => set("DueDate", e.target.value)} disabled={!mayRaise || pending} />
              </Field>
            </div>
            <Field label={t("col.owner")}>
              <input
                className="input" value={form.OwnerName}
                onChange={(e) => set("OwnerName", e.target.value)}
                placeholder={t("raise.ownerHint")}
                disabled={!mayRaise || pending}
              />
            </Field>
            <div>
              <Button variant="primary" disabled={!mayRaise || pending} onClick={() => void submit()}>
                {pending ? t("raise.working") : t("raise.submit")}
              </Button>{" "}
              {form.Type && (
                <Badge tone="warning">
                  {t("raise.windowHint", { days: String(REPEAT_WINDOW_DAYS) })}
                </Badge>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
