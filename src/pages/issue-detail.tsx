import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Alert, Badge, Button, Card, Empty, ErrorAlert, Field, Loading, Select } from "@/components/ui";
import {
  NEXT_STATUS, STATUS_LABEL,
  buyers, issueEvents, issues as issuesCrud, linesCrud, stylesCrud,
  type Status,
} from "@/features/data/garment-schemas";
import { issueEvent } from "@/features/issues/history";
import {
  canCloseIssue, canEditIssue, canRecordCorrection, canVerifyIssue, useAuthStore,
} from "@/stores/auth";
import { useI18nStore, useT } from "@/features/i18n/i18n";
import { formatDate, formatClock } from "@/lib/format";

/**
 * Who may make a given transition.
 *
 * The lifecycle says what MAY follow; this says who may do it. Verification is QA's
 * call and closing is the merchandiser's, so a supervisor can carry an issue as far as
 * Corrected and no further - which is the brief's separation of doing the work from
 * confirming it was done.
 */
function mayMove(to: Status, user: ReturnType<typeof useAuthStore.getState>["user"]): boolean {
  if (to === "Verified") return canVerifyIssue(user);
  if (to === "Closed") return canCloseIssue(user);
  return canRecordCorrection(user);
}

/**
 * The colour a history entry carries.
 *
 * Paired with the Kind badge and the from → to line that were already there, never
 * replacing them: colour alone would leave the trail unreadable to anyone who
 * cannot separate the hues, and this is the record of who decided what.
 */
function toneOf(kind: string, to: string): string {
  if (kind === "Rejected" || to === "Rejected") return "tl-danger";
  if (to === "Verified" || to === "Closed") return "tl-success";
  if (to === "CorrectionUnderWay" || to === "Corrected") return "tl-progress";
  if (kind === "Raised") return "tl-raised";
  if (to === "Reviewed") return "tl-progress";
  return "tl-note";
}

export function IssueDetailPage() {
  const { id = "" } = useParams();
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);
  const t = useT();

  const all = issuesCrud.useAll();
  const events = issueEvents.useAll();
  const styles = stylesCrud.useAll();
  const lines = linesCrud.useAll();
  const buyerList = buyers.useAll();

  const addEvent = issueEvents.useCreate();
  const updateIssue = issuesCrud.useUpdate();

  const [note, setNote] = useState("");
  const [target, setTarget] = useState<Status | "">("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const issue = useMemo(
    () => (all.data ?? []).find((i) => i.ItemId === id), [all.data, id]);

  /* Oldest first: a history is read forwards. */
  const timeline = useMemo(
    () => (events.data ?? [])
      .filter((e) => e.IssueId === id)
      .sort((a, b) => new Date(a.At).getTime() - new Date(b.At).getTime()),
    [events.data, id]);

  if (all.error) return <ErrorAlert error={all.error} />;
  if (all.isPending) return <Loading label={t("detail.loading")} />;
  if (!issue) return <Empty title={t("detail.notFound")}>{t("detail.notFoundBody")}</Empty>;

  const style = (styles.data ?? []).find((s) => s.ItemId === issue.StyleId);
  const line = (lines.data ?? []).find((l) => l.ItemId === issue.LineId);
  const buyer = (buyerList.data ?? []).find((b) => b.ItemId === issue.BuyerId);
  const nexts = NEXT_STATUS[issue.Status].filter((n) => mayMove(n, user));
  const mayWrite = canEditIssue(user) || nexts.length > 0;

  async function move() {
    if (!target || !issue) return;
    setBusy(true);
    setFailure(null);
    try {
      /*
       * History first, then the row. If the status write fails the trail carries an entry
       * for a change that did not happen, which is visible and correctable; the reverse
       * leaves a silent change nobody can account for, which the brief forbids.
       */
      await addEvent.mutateAsync(
        issueEvent(user, issue.ItemId, target === "Rejected" ? "Rejected" : "StatusChange",
          note.trim() || `Moved to ${STATUS_LABEL[target]}.`,
          { from: issue.Status, to: target }));
      await updateIssue.mutateAsync({
        where: { ItemId: { eq: issue.ItemId } },
        input: { Status: target, ...(target === "Closed" ? { ClosedAt: new Date().toISOString() } : {}) },
      });
      setNote("");
      setTarget("");
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  async function comment() {
    if (!note.trim() || !issue) return;
    setBusy(true);
    setFailure(null);
    try {
      await addEvent.mutateAsync(issueEvent(user, issue.ItemId, "Comment", note.trim()));
      setNote("");
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid one">
      <Card
        title={issue.Title}
        sub={`${issue.Type} · ${issue.Severity} · ${t("detail.raisedBy")} ${issue.RaisedByName || t("detail.unknown")}`}
        actions={
          /* A real button, not `quiet`: quiet draws neither border nor background,
             so the one way back off this page read as a line of text. */
          <Link to="/issues" className="back-link">
            <Button size="sm">
              <ArrowLeft size={15} aria-hidden />
              {t("detail.backToIssues")}
            </Button>
          </Link>
        }
      >
        <p>{issue.Description}</p>
        <dl className="kv">
          <dt>{t("col.status")}</dt><dd><Badge>{STATUS_LABEL[issue.Status]}</Badge></dd>
          <dt>{t("col.style")}</dt><dd>{style ? `${style.StyleCode} — ${style.Name}` : "—"}</dd>
          <dt>{t("col.buyer")}</dt><dd>{buyer?.Name ?? "—"}</dd>
          <dt>{t("col.line")}</dt><dd>{line?.Name ?? "—"}</dd>
          <dt>{t("raise.department")}</dt><dd>{issue.Department}</dd>
          <dt>{t("col.owner")}</dt><dd>{issue.OwnerName || "—"}</dd>
          <dt>{t("col.due")}</dt><dd>{issue.DueDate ? formatDate(issue.DueDate, locale) : "—"}</dd>
        </dl>
      </Card>

      <Card
        title={t("detail.history")}
        sub={t("detail.historySub")}
      >
        {failure ? <ErrorAlert error={failure} /> : null}
        {timeline.length === 0 ? (
          <Empty title={t("detail.nothingYet")} />
        ) : (
          <ol className="timeline">
            {timeline.map((e) => (
              <li key={e.ItemId} className={toneOf(e.Kind, e.ToStatus)}>
                <div className="tl-head">
                  <strong>{e.ActorName}</strong>
                  <span className="tl-when">{formatDate(e.At, locale)} {formatClock(e.At, locale)}</span>
                  <Badge tone={e.Kind === "Rejected" ? "danger" : "info"}>{e.Kind}</Badge>
                </div>
                <div className="tl-message">{e.Message}</div>
                {e.FromStatus && e.ToStatus ? (
                  <div className="tl-change">
                    {STATUS_LABEL[e.FromStatus as Status] ?? e.FromStatus} →{" "}
                    {STATUS_LABEL[e.ToStatus as Status] ?? e.ToStatus}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {/*
          Settled is worth saying plainly — the issue is finished, not withheld —
          so it gets an icon and a line of its own rather than a grey word wedged
          between two buttons. A transition this role simply may not make stays
          unannounced: the control is absent, which says the same thing without
          the lecture.
        */}
        {NEXT_STATUS[issue.Status].length === 0 && (
          <Alert tone="success" title={t("detail.settled")}>
            {t("detail.settledBody")}
          </Alert>
        )}

        {/*
          The composer belongs to whoever can act on an issue. It was rendered for
          every signed-in role, including one that may only read — an editable box
          and a live Add button, on an append-only register. A reader now gets the
          history and nothing that invites them to write to it.
        */}
        {mayWrite && (
          <>
            <Field label={t("detail.addToHistory")}>
              <textarea
                className="input"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("detail.addPlaceholder")}
              />
            </Field>

            <div className="row-actions">
              <Button onClick={comment} disabled={busy || !note.trim()}>{t("detail.addComment")}</Button>
              {nexts.length > 0 ? (
                <>
                  <Select value={target} onChange={(e) => setTarget(e.target.value as Status)}>
                    <option value="">{t("detail.moveTo")}</option>
                    {nexts.map((n) => <option key={n} value={n}>{STATUS_LABEL[n]}</option>)}
                  </Select>
                  <Button variant="primary" onClick={move} disabled={busy || !target}>
                    {t("detail.recordChange")}
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
