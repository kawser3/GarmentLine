/**
 * Raising an issue, with the repeat-defect rule attached.
 *
 * The case: "the same defect three times on one line must be impossible to
 * miss — warn on the second, before the third." The platform has no server-side
 * data trigger yet (Logic database triggers are on the roadmap, not shipped),
 * so this is where the rule lives: EVERY issue raise in the app goes through
 * here, and the window check runs over the raised set including the new row.
 *
 * The alert is a RepeatAlert row, not a toast: the GM's view reads the same
 * table, so a warning raised on Monday is still on the board on Friday.
 */
import { useCallback, useState } from "react";
import {
  issues, issueEvents, repeatAlerts,
  type Issue, type IssueType, type RepeatAlert,
} from "@/features/data/garment-schemas";
import { displayName, issueEvent } from "@/features/issues/history";
import { notifyRoles } from "@/features/notify/blocks-push";
import { useAuthStore } from "@/stores/auth";

export const REPEAT_WINDOW_DAYS = 10;
export const REPEAT_ALERT_AT = 2;

export interface RaiseInput {
  Title: string;
  Description: string;
  Type: IssueType;
  Severity: Issue["Severity"];
  StyleId: string;
  LineId: string;
  BuyerId: string;
  SampleVersionId?: string;
  OwnerId: string;
  OwnerName: string;
  Department: Issue["Department"];
  DueDate?: string;
  SourceCommentId?: string;
}

export interface RepeatSummary {
  occurrences: number;
  issueIds: string[];
  alertId?: string;
}

/**
 * Pure window check over the loaded issue set — exported so the dashboard can
 * run the same arithmetic it displays. `newItemId` is the issue being raised,
 * which is not in the loaded set yet. The window is platform CreatedDate:
 * every issue has it, set by the gateway, not writable from the app.
 */
export function detectRepeat(
  all: Issue[],
  type: IssueType,
  lineId: string,
  newItemId?: string,
): RepeatSummary | null {
  const since = Date.now() - REPEAT_WINDOW_DAYS * 86_400_000;
  const ids = all
    .filter(
      (i) =>
        i.Type === type &&
        i.LineId === lineId &&
        new Date(i.CreatedDate ?? Date.now()).getTime() >= since,
    )
    .map((i) => i.ItemId);
  if (newItemId) ids.push(newItemId);
  if (ids.length < REPEAT_ALERT_AT) return null;
  return { occurrences: ids.length, issueIds: ids.slice(-10) };
}

/** Human-readable warning, written once into the alert row. */
export function repeatMessage(type: IssueType, occurrences: number, windowDays: number): string {
  const ordinal = occurrences + 1 === 3 ? "3rd" : `${occurrences + 1}th`;
  return `${type} defects now ${occurrences}× on this line inside ${windowDays} days — ` +
    `a ${ordinal} occurrence means the pattern is systemic, not chance.`;
}

export function useRaiseIssue() {
  const user = useAuthStore((s) => s.user);
  const allIssues = issues.useAll();
  const allAlerts = repeatAlerts.useAll();
  const insertIssue = issues.useCreate();
  const insertEvent = issueEvents.useCreate();
  const insertAlert = repeatAlerts.useCreate();
  const updateAlert = repeatAlerts.useUpdate();
  const [pending, setPending] = useState(false);

  const raise = useCallback(
    async (input: RaiseInput): Promise<{ issueId: string; repeat: RepeatSummary | null }> => {
      setPending(true);
      try {
        const now = new Date().toISOString();
        const created = await insertIssue.mutateAsync({
          ...input,
          Status: "Raised",
          RaisedBy: user?.itemId ?? "",
          RaisedByName: displayName(user),
          ClosedAt: null,
        });
        const issueId = created?.itemId ?? "";

        await insertEvent.mutateAsync(
          issueEvent(user, issueId, "Raised", input.Description || input.Title, { to: "Raised" }),
        );

        const repeat = detectRepeat(allIssues.data ?? [], input.Type, input.LineId, issueId);
        let alertId: string | undefined;
        if (repeat) {
          const existing = (allAlerts.data ?? []).find(
            (a: RepeatAlert) => a.LineId === input.LineId && a.IssueType === input.Type && !a.Acknowledged,
          );
          const message = repeatMessage(input.Type, repeat.occurrences, REPEAT_WINDOW_DAYS);
          if (existing) {
            await updateAlert.mutateAsync({
              where: { ItemId: { eq: existing.ItemId } },
              input: {
                Occurrences: repeat.occurrences,
                IssueIds: repeat.issueIds,
                DetectedAt: now,
                Message: message,
              },
            });
            alertId = existing.ItemId;
          } else {
            const alert = await insertAlert.mutateAsync({
              LineId: input.LineId,
              IssueType: input.Type,
              WindowDays: REPEAT_WINDOW_DAYS,
              Occurrences: repeat.occurrences,
              IssueIds: repeat.issueIds,
              Message: message,
              Acknowledged: false,
              AcknowledgedBy: "",
            });
            alertId = alert?.itemId;
            /* First time the pattern is seen, the GM hears about it in-app too.
             * Fire-and-forget on purpose: the alert row is the record, the
             * notification is a door-knock. */
            void notifyRoles(
              ["factory-manager"],
              `Repeat defect: ${input.Type}`,
              message,
            );
          }
        }
        return { issueId, repeat: repeat ? { ...repeat, alertId } : null };
      } finally {
        setPending(false);
      }
    },
    [user, allIssues.data, allAlerts.data, insertIssue, insertEvent, insertAlert, updateAlert],
  );

  return { raise, pending };
}
