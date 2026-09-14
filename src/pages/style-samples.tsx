import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorAlert, Field, Loading, TableWrap } from "@/components/ui";
import {
  approvals as approvalsCrud, buyers, sampleVersions, stylesCrud,
  type ApprovalRecord, type Decision,
} from "@/features/data/garment-schemas";
import { BuyerCommentsPanel } from "@/features/comments/buyer-comments";
import { displayName } from "@/features/issues/history";
import { canApproveSample, useAuthStore } from "@/stores/auth";
import { useI18nStore } from "@/features/i18n/i18n";
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

  const styles = stylesCrud.useAll();
  const versions = sampleVersions.useAll();
  const records = approvalsCrud.useAll();
  const buyerList = buyers.useAll();

  const addRecord = approvalsCrud.useCreate();
  const updateVersion = sampleVersions.useUpdate();

  const [note, setNote] = useState("");
  const [busyOn, setBusyOn] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

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
    return <Loading label="Loading sample history…" />;
  }
  if (!style) return <Empty title="Style not found" />;

  const buyer = (buyerList.data ?? []).find((b) => b.ItemId === style.BuyerId);
  const approved = mine.find((v) => (recordsFor.get(v.ItemId) ?? [])[0]?.Decision === "Approved");
  const mayApprove = canApproveSample(user);

  async function decide(versionId: string, decision: Decision) {
    setBusyOn(versionId + decision);
    setFailure(null);
    try {
      /*
       * The record is written first and is the truth. The Status field on the version is
       * only a cache for list screens - if this second write fails the decision still
       * stands in the trail, which is the direction the brief requires the risk to fall.
       */
      await addRecord.mutateAsync({
        SampleVersionId: versionId,
        StyleId: styleId,
        Decision: decision,
        ActorId: user?.itemId ?? "",
        ActorName: displayName(user),
        DecidedAt: new Date().toISOString(),
        Note: note.trim(),
      });
      await updateVersion.mutateAsync({
        where: { ItemId: { eq: versionId } },
        input: { Status: decision },
      });
      setNote("");
    } catch (e) {
      setFailure(e);
    } finally {
      setBusyOn("");
    }
  }

  return (
    <>
      <Card
        span
        title={`${style.StyleCode} — ${style.Name}`}
        sub={`${buyer?.Name ?? "Unknown buyer"} · ${style.Season} · ${style.OrderQty.toLocaleString()} pcs`}
        actions={<Link to="/samples"><Button variant="quiet" size="sm">Back to samples</Button></Link>}
      >
        <p>
          <strong>Approved version: </strong>
          {approved
            ? <Badge tone="success">{approved.Type} v{approved.VersionNo}</Badge>
            : <Badge tone="danger">None approved — bulk must not start</Badge>}
        </p>
        {!mayApprove && (
          <p className="muted">
            Marking a sample approved is a decision of record. Your role can read this
            history but not add to it.
          </p>
        )}
      </Card>

      <Card span title="Versions and decisions" sub="Every decision is kept; none can be edited or removed.">
        {failure ? <ErrorAlert error={failure} /> : null}
        {mine.length === 0 ? (
          <Empty title="No sample versions recorded for this style" />
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Version</th><th>Submitted</th><th>Standing decision</th>
                  <th>History</th>{mayApprove && <th>Decide</th>}
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
                          : <Badge tone="warning">Awaiting decision</Badge>}
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
                              Approve
                            </Button>
                            <Button
                              variant="danger" size="sm"
                              disabled={!!busyOn}
                              onClick={() => decide(v.ItemId, "Rejected")}
                            >
                              Reject
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {mayApprove && (
          <Field label="Note to attach to the next decision">
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason the buyer gave, or the condition attached"
            />
          </Field>
        )}
      </Card>

      <BuyerCommentsPanel styleId={styleId} buyerId={style.BuyerId} />
    </>
  );
}
