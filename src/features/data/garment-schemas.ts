/**
 * The GarmentLine domain, as typed CRUD over the Blocks Data gateway.
 *
 * Operation names are NOT hand-derived. They were read back from /data/v4/schemas
 * after the define and mirrored into generated/blocks-operations.ts by
 * scripts/01-define-schemas.mjs. They happen to pluralise naturally here, but the
 * platform pluralises by appending "s" with no regard for English, so the generated
 * file stays the source of truth.
 */
import { makeCrud, type SystemFields } from "./make-crud";

/* ------------------------------------------------------------------- enums */

export const ISSUE_TYPES = ["Shade", "Stitch", "Measurement", "Trim", "Finishing", "Other"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DEPARTMENTS = ["Pattern", "Cutting", "Dyeing", "Sewing", "Finishing", "QA"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/**
 * The lifecycle the brief names, in order, plus the reject branch it asks for
 * ("with the option for the buyer or QA to reject and send it back").
 */
export const STATUSES = [
  "Raised", "Reviewed", "CorrectionUnderWay", "Corrected", "Verified", "Closed", "Rejected",
] as const;
export type Status = (typeof STATUSES)[number];

export const OPEN_STATUSES: Status[] = ["Raised", "Reviewed", "CorrectionUnderWay", "Corrected"];

/** Human labels - "CorrectionUnderWay" is a field value, not something to show a supervisor. */
export const STATUS_LABEL: Record<Status, string> = {
  Raised: "Raised",
  Reviewed: "Reviewed",
  CorrectionUnderWay: "Correction under way",
  Corrected: "Corrected",
  Verified: "Verified",
  Closed: "Closed",
  Rejected: "Rejected",
};

/**
 * What a status may become. Encoded here rather than left to each screen, so the
 * detail page cannot offer a transition the append-only history would then have to
 * explain. Rejected sends the issue back to correction, which is the brief's
 * "reject and send it back".
 */
export const NEXT_STATUS: Record<Status, Status[]> = {
  Raised: ["Reviewed", "Rejected"],
  Reviewed: ["CorrectionUnderWay", "Rejected"],
  CorrectionUnderWay: ["Corrected", "Rejected"],
  Corrected: ["Verified", "Rejected"],
  Verified: ["Closed", "Rejected"],
  Closed: [],
  Rejected: ["CorrectionUnderWay"],
};

export const SAMPLE_TYPES = ["Proto", "Fit", "PP"] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const APPROVAL_DECISIONS = ["Approved", "Rejected"] as const;
export type Decision = (typeof APPROVAL_DECISIONS)[number];

export const ACTION_STATES = ["Proposed", "Accepted", "Edited", "Rejected"] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/* ------------------------------------------------------------------ records */

export interface Buyer extends SystemFields {
  Name: string; Country: string; ContactEmail: string;
  PreferredLanguage: string; IsActive: boolean;
}
export interface Style extends SystemFields {
  StyleCode: string; Name: string; BuyerId: string; Season: string;
  OrderQty: number; ShipDate: string; MerchandiserId: string; IsActive: boolean;
}
export interface Line extends SystemFields {
  Name: string; PlantId: string; SupervisorId: string; WorkerCount: number; IsActive: boolean;
}
export interface SampleVersion extends SystemFields {
  StyleId: string; Type: SampleType; VersionNo: number;
  Status: "Submitted" | Decision; SubmittedAt: string;
  EvidenceFileIds: string[]; Notes: string;
}
export interface ApprovalRecord extends SystemFields {
  SampleVersionId: string; StyleId: string; Decision: Decision;
  ActorId: string; ActorName: string; DecidedAt: string; Note: string;
}
export interface Issue extends SystemFields {
  Title: string; Description: string; Type: IssueType; Severity: Severity; Status: Status;
  StyleId: string; LineId: string; BuyerId: string; SampleVersionId: string;
  OwnerId: string; OwnerName: string; Department: Department;
  /** When it was raised on the floor. CreatedDate is when the ROW was written —
   *  the two differ for anything seeded, imported or back-dated, and every
   *  "last 30 days" figure means this one. */
  RaisedAt: string | null;
  DueDate: string; RaisedBy: string; RaisedByName: string;
  SourceCommentId: string; ClosedAt: string | null;
}
export interface IssueEvent extends SystemFields {
  IssueId: string; Kind: string; ActorId: string; ActorName: string; At: string;
  Message: string; FromStatus: string; ToStatus: string; EvidenceFileIds: string[];
}
export interface BuyerComment extends SystemFields {
  StyleId: string; SampleVersionId: string; RawText: string; Channel: string;
  ReceivedAt: string; ParsedAt: string | null; ParsedBy: string;
}
export interface ActionItem extends SystemFields {
  BuyerCommentId: string; IssueId: string; What: string; Part: string;
  Department: Department; Urgency: Severity; State: ActionState;
  Sequence: number; AcceptedBy: string; AcceptedAt: string | null;
}
export interface RepeatAlert extends SystemFields {
  LineId: string; IssueType: IssueType; WindowDays: number; Occurrences: number;
  DetectedAt: string; IssueIds: string[]; Message: string;
  Acknowledged: boolean; AcknowledgedBy: string;
}
export interface CostAssumption extends SystemFields {
  Key: string; Value: number; Unit: string; Note: string;
}

/* --------------------------------------------------------------------- crud */

const names = (n: string) => ({
  query: `get${n}s`, insert: `insert${n}`, update: `update${n}`, remove: `delete${n}`,
  filterType: `${n}FilterInput`, insertType: `${n}InsertInput`, updateType: `${n}UpdateInput`,
});

const F = {
  Buyer: "ItemId Name Country ContactEmail PreferredLanguage IsActive",
  Style: "ItemId StyleCode Name BuyerId Season OrderQty ShipDate MerchandiserId IsActive",
  Line: "ItemId Name PlantId SupervisorId WorkerCount IsActive",
  SampleVersion: "ItemId StyleId Type VersionNo Status SubmittedAt EvidenceFileIds Notes",
  ApprovalRecord: "ItemId SampleVersionId StyleId Decision ActorId ActorName DecidedAt Note",
  /* CreatedDate is gateway-stamped at insert; without it in the projection every row
   * arrives with the field undefined, and any "last N days" filter silently empties. */
  Issue: "ItemId CreatedDate RaisedAt Title Description Type Severity Status StyleId LineId BuyerId SampleVersionId " +
         "OwnerId OwnerName Department DueDate RaisedBy RaisedByName SourceCommentId ClosedAt",
  IssueEvent: "ItemId IssueId Kind ActorId ActorName At Message FromStatus ToStatus EvidenceFileIds",
  BuyerComment: "ItemId StyleId SampleVersionId RawText Channel ReceivedAt ParsedAt ParsedBy",
  ActionItem: "ItemId BuyerCommentId IssueId What Part Department Urgency State Sequence AcceptedBy AcceptedAt",
  RepeatAlert: "ItemId LineId IssueType WindowDays Occurrences DetectedAt IssueIds Message Acknowledged AcknowledgedBy",
  CostAssumption: "ItemId Key Value Unit Note",
};

type Ins<T> = Partial<Omit<T, keyof SystemFields>>;

export const buyers = makeCrud<Buyer, Ins<Buyer>, Ins<Buyer>>(names("Buyer"), F.Buyer);
export const stylesCrud = makeCrud<Style, Ins<Style>, Ins<Style>>(names("Style"), F.Style);
export const linesCrud = makeCrud<Line, Ins<Line>, Ins<Line>>(names("Line"), F.Line);
export const sampleVersions = makeCrud<SampleVersion, Ins<SampleVersion>, Ins<SampleVersion>>(names("SampleVersion"), F.SampleVersion);
export const approvals = makeCrud<ApprovalRecord, Ins<ApprovalRecord>, Ins<ApprovalRecord>>(names("ApprovalRecord"), F.ApprovalRecord);
export const issues = makeCrud<Issue, Ins<Issue>, Ins<Issue>>(names("Issue"), F.Issue);
export const issueEvents = makeCrud<IssueEvent, Ins<IssueEvent>, Ins<IssueEvent>>(names("IssueEvent"), F.IssueEvent);
export const buyerComments = makeCrud<BuyerComment, Ins<BuyerComment>, Ins<BuyerComment>>(names("BuyerComment"), F.BuyerComment);
export const actionItems = makeCrud<ActionItem, Ins<ActionItem>, Ins<ActionItem>>(names("ActionItem"), F.ActionItem);
export const repeatAlerts = makeCrud<RepeatAlert, Ins<RepeatAlert>, Ins<RepeatAlert>>(names("RepeatAlert"), F.RepeatAlert);
export const costAssumptions = makeCrud<CostAssumption, Ins<CostAssumption>, Ins<CostAssumption>>(names("CostAssumption"), F.CostAssumption);
