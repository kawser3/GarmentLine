/**
 * The buyer-comment console: raw comment in, reviewable action list out.
 *
 * This is the case's AI feature, and its shape is dictated by one sentence:
 * "a human accepts each item — the AI never writes an official record." So the
 * panel has two halves with a hard floor between them:
 *
 *   propose — parse the paragraph (Blocks AI agent; labelled fallback otherwise)
 *             and store each proposed action as an ActionItem in state Proposed.
 *   accept  — the merchandiser edits any line, then accepts or rejects it. Only
 *             acceptance creates an Issue, through the same raise path that
 *             enforces the repeat-defect rule.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorAlert, Field, Loading, TableWrap } from "@/components/ui";
import {
  actionItems, buyerComments, linesCrud, sampleVersions,
  DEPARTMENTS, SEVERITIES, ISSUE_TYPES,
  type ActionItem, type BuyerComment, type Department, type IssueType, type Severity,
} from "@/features/data/garment-schemas";
import { displayName } from "@/features/issues/history";
import { useRaiseIssue } from "@/features/issues/raise";
import { parseBuyerComment, type ParsedAction } from "@/features/comments/parse-comment";
import { canAcceptActionItem, useAuthStore } from "@/stores/auth";
import { useI18nStore } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

const CHANNELS = ["Email", "WhatsApp", "TechPack"] as const;

interface Draft extends ParsedAction {
  /** Local edits before accept; null once the row has been decided. */
  decided: null | "Accepted" | "Rejected";
  issueId?: string;
}

export function BuyerCommentsPanel({ styleId, buyerId }: { styleId: string; buyerId: string }) {
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);
  const mayWork = canAcceptActionItem(user);

  const comments = buyerComments.useAll();
  const items = actionItems.useAll();
  const versions = sampleVersions.useAll();
  const lines = linesCrud.useAll();
  const insertComment = buyerComments.useCreate();
  const updateComment = buyerComments.useUpdate();
  const insertItem = actionItems.useCreate();
  const updateItem = actionItems.useUpdate();
  const { raise } = useRaiseIssue();

  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("Email");
  const [versionId, setVersionId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [engineNote, setEngineNote] = useState<string>("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState("");

  const mine = useMemo(
    () =>
      (comments.data ?? [])
        .filter((c) => c.StyleId === styleId)
        .sort((a, b) => new Date(b.ReceivedAt).getTime() - new Date(a.ReceivedAt).getTime()),
    [comments.data, styleId],
  );

  /* Derived, not stored: the insert invalidates the comment list, and a state copy
   * captured at insert time would go stale the moment the refetch lands. */
  const activeComment = mine.find((c) => c.ItemId === activeId) ?? null;

  const styleVersions = useMemo(
    () =>
      (versions.data ?? [])
        .filter((v) => v.StyleId === styleId)
        .sort((a, b) => b.VersionNo - a.VersionNo),
    [versions.data, styleId],
  );

  const decidedItems = useMemo(
    () => (items.data ?? []).filter((i) => i.BuyerCommentId === activeComment?.ItemId),
    [items.data, activeComment],
  );

  if (comments.isPending || versions.isPending) return <Loading label="Loading buyer comments…" />;

  async function recordAndParse() {
    setBusy(true);
    setFailure(null);
    setDrafts([]);
    setEngineNote("");
    try {
      const targetVersion = versionId || styleVersions[0]?.ItemId || "";
      const created = await insertComment.mutateAsync({
        StyleId: styleId,
        SampleVersionId: targetVersion,
        RawText: text.trim(),
        Channel: channel,
        ReceivedAt: new Date().toISOString(),
        ParsedAt: null,
        ParsedBy: "",
      });
      const commentId = created?.itemId ?? "";
      await parseAndStore(commentId, text.trim());
      setText("");
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  async function parseAndStore(commentId: string, raw: string) {
    const result = await parseBuyerComment(raw);
    const now = new Date().toISOString();
    setEngineNote(
      result.engine === "blocks-ai-agent"
        ? `Proposed by the Blocks AI agent ${new Date(now).toLocaleTimeString()}.`
        : result.engineNote ?? "Parsed with the built-in fallback parser.",
    );
    await updateComment.mutateAsync({
      where: { ItemId: { eq: commentId } },
      input: { ParsedAt: now, ParsedBy: result.engine },
    });
    setDrafts(
      result.items.map((a) => ({ ...a, decided: null })),
    );
    for (const [n, a] of result.items.entries()) {
      await insertItem.mutateAsync({
        BuyerCommentId: commentId,
        IssueId: "",
        What: a.What,
        Part: a.Part,
        Department: a.Department,
        Urgency: a.Urgency,
        State: "Proposed",
        Sequence: n + 1,
        AcceptedBy: "",
        AcceptedAt: null,
      });
    }
    setActiveId(commentId);
  }

  function patchDraft(i: number, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  }

  async function decideRow(i: number, decision: "Accepted" | "Rejected") {
    const d = drafts[i];
    if (!d || !activeComment) return;
    setBusy(true);
    setFailure(null);
    try {
      let issueId = "";
      if (decision === "Accepted") {
        /* The only path from proposal to official record, and it is a human click. */
        const line = (lines.data ?? []).find((l) => l.IsActive);
        const r = await raise({
          Title: `${d.Part}: ${d.What}`.slice(0, 120),
          Description: `From buyer comment received ${formatDate(activeComment.ReceivedAt, locale)} (${activeComment.Channel}). ` +
            `AI-proposed, reviewed and accepted by ${displayName(user)}.`,
          Type: d.IssueType,
          Severity: d.Urgency,
          StyleId: styleId,
          LineId: line?.ItemId ?? "",
          BuyerId: buyerId,
          SampleVersionId: activeComment.SampleVersionId,
          OwnerId: user?.itemId ?? "",
          OwnerName: displayName(user),
          Department: d.Department,
          SourceCommentId: activeComment.ItemId,
        });
        issueId = r.issueId;
      }
      /* The stored proposal is marked with what the human actually decided, including
       * any edits — the audit trail of "AI said / merchandiser approved". Sequence is
       * the stable match: the What text may have been edited since insertion. */
      const rows = (items.data ?? []).filter((it: ActionItem) => it.BuyerCommentId === activeComment.ItemId);
      const row = rows.find((it) => it.Sequence === i + 1);
      if (row) {
        await updateItem.mutateAsync({
          where: { ItemId: { eq: row.ItemId } },
          input: {
            What: d.What, Part: d.Part, Department: d.Department, Urgency: d.Urgency,
            State: decision,
            AcceptedBy: user?.itemId ?? "",
            AcceptedAt: new Date().toISOString(),
            IssueId: issueId,
          },
        });
      }
      patchDraft(i, { decided: decision, issueId: issueId || undefined });
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      span
      title="Buyer comments → action list"
      sub="Paste the comment as it arrived. The AI proposes; the merchandiser decides."
    >
      {failure ? <ErrorAlert error={failure} /> : null}

      {mayWork ? (
        <div className="stack">
          <div className="grid-2">
            <Field label="Channel">
              <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Sample version">
              <select className="input" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                <option value="">Latest</option>
                {styleVersions.map((v) => (
                  <option key={v.ItemId} value={v.ItemId}>{v.Type} v{v.VersionNo}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Buyer comment (Banglish is fine)">
            <textarea
              className="input"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. body length thik ache but CB length 1cm kom lagche, placket ektu wide, collar tipping e shading…"
            />
          </Field>
          <div>
            <Button variant="primary" disabled={busy || !text.trim()} onClick={recordAndParse}>
              {busy ? "Working…" : "Record & propose actions"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="muted">
          Recording buyer comments and accepting AI proposals is the merchandiser's call.
        </p>
      )}

      {drafts.length > 0 && (
        <div className="stack">
          <p>
            <Badge tone={engineNote.startsWith("Proposed by the Blocks AI") ? "success" : "warning"}>
              {engineNote.startsWith("Proposed by the Blocks AI") ? "Blocks AI agent" : "Fallback parser"}
            </Badge>{" "}
            <span className="muted">{engineNote}</span>
          </p>
          <TableWrap>

              <thead>
                <tr>
                  <th>#</th><th>Action (editable)</th><th>Part</th><th>Dept</th>
                  <th>Urgency</th><th>Type</th><th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr key={i} className={d.decided ? "muted" : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        className="input" value={d.What} disabled={!!d.decided}
                        onChange={(e) => patchDraft(i, { What: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input" value={d.Part} disabled={!!d.decided}
                        onChange={(e) => patchDraft(i, { Part: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input" value={d.Department} disabled={!!d.decided}
                        onChange={(e) => patchDraft(i, { Department: e.target.value as Department })}
                      >
                        {DEPARTMENTS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input" value={d.Urgency} disabled={!!d.decided}
                        onChange={(e) => patchDraft(i, { Urgency: e.target.value as Severity })}
                      >
                        {SEVERITIES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input" value={d.IssueType} disabled={!!d.decided}
                        onChange={(e) => patchDraft(i, { IssueType: e.target.value as IssueType })}
                      >
                        {ISSUE_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td>
                      {d.decided ? (
                        d.decided === "Accepted" && d.issueId ? (
                          <>Accepted → <Link to={`/issues/${d.issueId}`}>issue</Link></>
                        ) : (
                          <Badge tone={d.decided === "Accepted" ? "success" : "danger"}>{d.decided}</Badge>
                        )
                      ) : (
                        <div className="row-actions">
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => decideRow(i, "Accepted")}>
                            Accept
                          </Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => decideRow(i, "Rejected")}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          <p className="muted">
            Nothing above exists as an issue yet. Accepting a row raises it through the normal
            path — owner, due date, and the repeat-defect rule included.
          </p>
        </div>
      )}

      <div className="stack">
        <h3>Recorded comments</h3>
        {mine.length === 0 ? (
          <Empty title="No buyer comments recorded for this style" />
        ) : (
          <TableWrap>

              <thead>
                <tr><th>Received</th><th>Channel</th><th>Comment</th><th>Parsed</th></tr>
              </thead>
              <tbody>
                {mine.map((c) => {
                  const its = (items.data ?? []).filter((x) => x.BuyerCommentId === c.ItemId);
                  const accepted = its.filter((x) => x.State === "Accepted").length;
                  return (
                    <tr key={c.ItemId}>
                      <td>{formatDate(c.ReceivedAt, locale)}</td>
                      <td><Badge>{c.Channel}</Badge></td>
                      <td className="wrap">{c.RawText}</td>
                      <td>
                        {c.ParsedAt ? (
                          <span>
                            {accepted}/{its.length} accepted
                            <div className="muted">by {c.ParsedBy === "blocks-ai-agent" ? "Blocks AI agent" : c.ParsedBy}</div>
                          </span>
                        ) : (
                          <Badge tone="warning">Not parsed</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
        )}
        {decidedItems.length > 0 && activeComment ? (
          <p className="muted">
            Decisions on the latest comment are kept as ActionItems — {decidedItems.filter((x: ActionItem) => x.State === "Accepted").length} accepted.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
