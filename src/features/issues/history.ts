/**
 * Writing the append-only history.
 *
 * Every state change on an issue writes an IssueEvent. Nothing in the app ever updates
 * or deletes one: the brief requires history that "can be added to, never edited or
 * deleted", and the collection's access policy is the thing that enforces it. These
 * helpers exist so no screen has to remember the shape of an entry.
 *
 * The actor's display name is captured AT THE TIME rather than joined at read time. A
 * person can be renamed, leave, or have their roles revoked; what the trail must show is
 * who acted then, under the name they acted under.
 */
import type { Status } from "@/features/data/garment-schemas";
import type { BlocksUser } from "@/stores/auth";

export type EventKind =
  | "Raised" | "Comment" | "StatusChange" | "Assigned" | "Evidence" | "Verified" | "Rejected";

export function displayName(user: BlocksUser | null | undefined): string {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return full || user?.email || "Unknown";
}

export interface NewEvent {
  IssueId: string;
  Kind: EventKind;
  ActorId: string;
  ActorName: string;
  At: string;
  Message: string;
  FromStatus: string;
  ToStatus: string;
  EvidenceFileIds: string[];
}

export function issueEvent(
  user: BlocksUser | null | undefined,
  issueId: string,
  kind: EventKind,
  message: string,
  opts: { from?: Status | ""; to?: Status | ""; evidence?: string[] } = {},
): NewEvent {
  return {
    IssueId: issueId,
    Kind: kind,
    ActorId: user?.itemId ?? "",
    ActorName: displayName(user),
    At: new Date().toISOString(),
    Message: message,
    FromStatus: opts.from ?? "",
    ToStatus: opts.to ?? "",
    EvidenceFileIds: opts.evidence ?? [],
  };
}
