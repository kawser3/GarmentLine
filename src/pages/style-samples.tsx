import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorAlert, Field, Loading, TableWrap } from "@/components/ui";
import {
  approvals as approvalsCrud, buyers, sampleVersions, stylesCrud,
  SAMPLE_TYPES,
  type ApprovalRecord, type Decision, type SampleType,
} from "@/features/data/garment-schemas";
import { BuyerCommentsPanel } from "@/features/comments/buyer-comments";
import { notifyRoles, sendSampleDecisionMail } from "@/features/notify/blocks-push";
import { issues as issuesCrud } from "@/features/data/garment-schemas";
import { displayName } from "@/features/issues/history";
import { canApproveSample, useAuthStore } from "@/stores/auth";
import { useI18nStore, useT } from "@/features/i18n/i18n";
import { formatClock, formatDate } from "@/lib/format";

/**
 * The decision of record.
 *
 * The brief: "Record each sample version and mark - with a timestamp and a person -
 * when a buyer approves or rejects it, so 'which version is approved' always has one
 * answer." So the answer is never a mutable status field on its own: it is derived from
 * ApprovalRecord, which is append-only. The Status column on SampleVersion is a cache of
 * the latest decision, written after the record, and the record is what the page reads.
 */
export function StyleSamplesPage() {
  const { styleId = "" } = useParams();
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);
  const t = useT();

  const styles = stylesCrud.useAll();
  const versions = sampleVersions.useAll();
  const records = approvalsCrud.useAll();
  const buyerList = buyers.useAll();
  const allIssues = issuesCrud.useAll();

  const addRecord = approvalsCrud.useCreate();
  const updateVersion = sampleVersions.useUpdate();

  const [note, setNote] = useState("");
  const [busyOn, setBusyOn] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [pushNote, setPushNote] = useState("");

  /* Submit-version form: the next version number per type is derived, not typed. */
  const addVersion = sampleVersions.useCreate();
  const [svType, setSvType] = useState<SampleType>("PP");
  const [svNotes, setSvNotes] = useState("");
  const [svBusy, setSvBusy] = useState(false);

  const style = useMemo(
    () => (styles.data ?? []).find((s) => s.ItemId === styleId), [styles.data, styleId]);

  const mine = useMemo(
    () => (versions.data ?? [])
      .filter((v) => v.StyleId === styleId)
      .sort((a, b) => new Date(b.SubmittedAt).getTime() - new Date(a.SubmittedAt).getTime()),
    [versions.data, styleId]);

  /* Decisions per version, newest first - the head of each list is the standing one. */
  const recordsFor = useMemo(() => {
    const m = new Map<string, ApprovalRecord[]>();
    for (const r of records.data ?? []) {
      const list = m.get(r.SampleVersionId) ?? [];
      list.push(r);
      m.set(r.SampleVersionId, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => new Date(b.DecidedAt).getTime() - new Date(a.DecidedAt).getTime());
    }
    return m;
  }, [records.data]);

  if (styles.error) return <ErrorAlert error={styles.error} />;
  if (styles.isPending || versions.isPending || records.isPending) {
    return <Loading label={t("sample.loading")} />;
  }
  if (!style) return <Empty title={t("sample.notFound")} />;

  const buyer = (buyerList.data ?? []).find((b) => b.ItemId === style.BuyerId);
  const approved = mine.find((v) => (recordsFor.get(v.ItemId) ?? [])[0]?.Decision === "Approved");
  const mayApprove = canApproveSample(user);

  async function submitVersion() {
    setSvBusy(true);
    setFailure(null);
    try {
      const nextNo =
        mine.filter((v) => v.Type === svType).reduce((m, v) => Math.max(m, v.VersionNo), 0) + 1;
      await addVersion.mutateAsync({
        StyleId: styleId,
        Type: svType,
        VersionNo: nextNo,
        Status: "Submitted",
        SubmittedAt: new Date().toISOString(),
        EvidenceFileIds: [],
        Notes: svNotes.trim(),
      });
      setSvNotes("");
    } catch (e) {
      setFailure(e);
    } finally {
      setSvBusy(false);
    }
  }

  async function decide(versionId: string, decision: Decision) {
    /* Narrowed by the `!style` early return above, but not through this closure. */
    if (!style) return;
    setBusyOn(versionId + decision);
    setFailure(null);
    try {
      /*
       * The record is written first and is the truth. The Status field on the version is
       * only a cache for list screens - if this second write fails the decision still
       * stands in the trail, which is the direction the brief requires the risk to fall.
       */
      const decidedAt = new Date().toISOString();
      await addRecord.mutateAsync({
        SampleVersionId: versionId,
        StyleId: styleId,
        Decision: decision,
        ActorId: user?.itemId ?? "",
        ActorName: displayName(user),
        DecidedAt: decidedAt,
        Note: note.trim(),
      });
      await updateVersion.mutateAsync({
        where: { ItemId: { eq: versionId } },
        input: { Status: decision },
      });
      setNote("");

      /*
       * Notice, not record: the mail to the buyer and the notification to the
       * factory fire after the decision stands. allSettled because a dead SMTP
       * must not unwind a decision of record — the note below reports honestly.
       */
      const version = mine.find((v) => v.ItemId === versionId);
      const openOnStyle = (allIssues.data ?? []).filter(
        (i) => i.StyleId === styleId && i.Status !== "Closed" && i.Status !== "Verified",
      ).length;
      const [mail] = await Promise.allSettled([
        buyer?.ContactEmail
          ? sendSampleDecisionMail({
              to: buyer.ContactEmail,
              buyerName: buyer.Name,
              styleCode: style.StyleCode,
              sampleLabel: version ? `${version.Type} v${version.VersionNo}` : "sample",
              decision,
              decidedBy: `${displayName(user)} (Merchandiser)`,
              decidedAt: `${formatDate(decidedAt, locale)} ${formatClock(decidedAt, locale)}`,
              openIssues: openOnStyle,
              note: note.trim() || undefined,
            })
          : Promise.resolve({ ok: false, error: "no buyer contact email" }),
        notifyRoles(
          ["factory-manager", "merchandiser"],
          `Sample ${decision.toLowerCase()}: ${style.StyleCode}`,
          `${displayName(user)} recorded ${decision} on ${style.StyleCode} ` +
            `${version ? `${version.Type} v${version.VersionNo}` : ""}.`,
        ),
      ]);
      setPushNote(
        mail.status === "fulfilled" && mail.value.ok
          ? `Decision stamped. Buyer notice emailed to ${buyer?.ContactEmail}.`
          : "Decision stamped. Buyer mail could not be sent — the register stands; resend from Mail.",
      );
    } catch (e) {
      setFailure(e);
    } finally {
      setBusyOn("");
    }
  }

  return (
    <div className="grid one">
      <Card
        span
        title={`${style.StyleCode} — ${style.Name}`}
        sub={`${buyer?.Name ?? "Unknown buyer"} · ${style.Season} · ${style.OrderQty.toLocaleString()} pcs`}
        actions={<Link to="/samples"><Button variant="quiet" size="sm">{t("sample.back")}</Button></Link>}
      >
        <p>
          <strong>{t("sample.approvedVersion")} </strong>
          {approved
            ? <Badge tone="success">{approved.Type} v{approved.VersionNo}</Badge>
            : <Badge tone="danger">{t("sample.noneApproved")}</Badge>}
        </p>
        {pushNote && <p className="muted">{pushNote}</p>}

      </Card>

      <Card span title={t("sample.versionsCard")} sub={t("sample.versionsSub")}>
        {failure ? <ErrorAlert error={failure} /> : null}
        {mine.length === 0 ? (
          <Empty title={t("sample.noVersions")} />
        ) : (
          <TableWrap>

              <thead>
                <tr>
                  <th>{t("sample.version")}</th><th>{t("col.submitted")}</th><th>{t("sample.standing")}</th>
                  <th>{t("col.history")}</th>{mayApprove && <th>{t("sample.decide")}</th>}
                </tr>
              </thead>
              <tbody>
                {mine.map((v) => {
                  const history = recordsFor.get(v.ItemId) ?? [];
                  const latest = history[0];
                  return (
                    <tr key={v.ItemId}>
                      <td><strong>{v.Type} v{v.VersionNo}</strong><div className="muted">{v.Notes}</div></td>
                      <td>{formatDate(v.SubmittedAt, locale)}</td>
                      <td>
                        {latest
                          ? <Badge tone={latest.Decision === "Approved" ? "success" : "danger"}>
                              {latest.Decision}
                            </Badge>
                          : <Badge tone="warning">{t("sample.awaiting")}</Badge>}
                      </td>
                      <td>
                        {history.length === 0 ? <span className="muted">—</span> : (
                          <ul className="plain">
                            {history.map((r) => (
                              <li key={r.ItemId}>
                                <strong>{r.Decision}</strong> by {r.ActorName},{" "}
                                {formatDate(r.DecidedAt, locale)} {formatClock(r.DecidedAt, locale)}
                                {r.Note ? <div className="muted">{r.Note}</div> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      {mayApprove && (
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="primary" size="sm"
                              disabled={!!busyOn}
                              onClick={() => decide(v.ItemId, "Approved")}
                            >
                              {t("sample.approve")}
                            </Button>
                            <Button
                              variant="danger" size="sm"
                              disabled={!!busyOn}
                              onClick={() => decide(v.ItemId, "Rejected")}
                            >
                              {t("sample.reject")}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
        )}
        {mayApprove && (
          <Field label={t("sample.noteLabel")}>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("sample.notePlaceholder")}
            />
          </Field>
        )}
      </Card>

      {mayApprove && (
        <Card
          span
          title={t("sample.submitCard")}
          sub={t("sample.submitSub")}
        >
          <div className="stack">
            <div className="grid-2">
              <Field label={t("sample.type")}>
                <select className="input" value={svType} onChange={(e) => setSvType(e.target.value as SampleType)}>
                  {SAMPLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t("sample.note")}>
                <input
                  className="input" value={svNotes} onChange={(e) => setSvNotes(e.target.value)}
                  placeholder={t("sample.changedPlaceholder")}
                />
              </Field>
            </div>
            <div>
              <Button variant="primary" disabled={svBusy} onClick={() => void submitVersion()}>
                {svBusy ? t("sample.submitting") : t("sample.submit")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <BuyerCommentsPanel styleId={styleId} buyerId={style.BuyerId} />
    </div>
  );
}
