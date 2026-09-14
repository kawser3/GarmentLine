// The eleven collections from PLAN §2.
//
// Blocks adds these to every entity automatically - defining any of them here
// produces a conflicting definition, so they are absent on purpose:
//   ItemId, CreatedDate, CreatedBy, LastUpdatedDate, LastUpdatedBy,
//   Language, OrganizationId, Tags
//
// Field types accepted by /data/v4/schemas/define: String, Int, Float,
// Boolean, DateTime - arrays are the same types with isArray: true.

const S = (name, description, extra = {}) => ({ name, type: 'String', description, ...extra });
const I = (name, description) => ({ name, type: 'Int', description });
const F = (name, description) => ({ name, type: 'Float', description });
const B = (name, description) => ({ name, type: 'Boolean', description });
const D = (name, description) => ({ name, type: 'DateTime', description });
const SA = (name, description) => ({ name, type: 'String', isArray: true, description });

export const schemas = [
  {
    schemaName: 'Buyer',
    description: 'European fast-fashion buyer, e.g. Nordic Retail AB. Scopes what a merchandiser sees.',
    fields: [
      S('Name', 'Buyer name', { isUniqueData: true }),
      S('Country', 'Buyer country'),
      S('ContactEmail', 'Where approval reports are sent', { isPIIData: true }),
      S('PreferredLanguage', 'Locale for reports and mail, e.g. en'),
      B('IsActive', 'Soft-delete flag'),
    ],
  },
  {
    schemaName: 'Style',
    description: 'A garment style moving through the sampling cycle, e.g. ST-2451 mens knit polo.',
    fields: [
      S('StyleCode', 'Buyer-facing code, e.g. ST-2451', { isUniqueData: true }),
      S('Name', 'Style description'),
      S('BuyerId', 'Buyer.ItemId'),
      S('Season', 'Season, e.g. SS26'),
      I('OrderQty', 'Order quantity in pieces - drives cost impact'),
      D('ShipDate', 'Contracted ship date'),
      S('MerchandiserId', 'IAM user id of the owning merchandiser - scopes visibility'),
      B('IsActive', 'Soft-delete flag'),
    ],
  },
  {
    schemaName: 'Line',
    description: 'A production line on the floor. Scopes what a supervisor sees.',
    fields: [
      S('Name', 'Line name, e.g. Line 4', { isUniqueData: true }),
      S('PlantId', 'Plant or unit identifier'),
      S('SupervisorId', 'IAM user id of the line supervisor - scopes visibility'),
      I('WorkerCount', 'Workers on the line'),
      B('IsActive', 'Soft-delete flag'),
    ],
  },
  {
    schemaName: 'SampleVersion',
    description: 'One version of a sample for a style. The thing a buyer approves or rejects.',
    fields: [
      S('StyleId', 'Style.ItemId'),
      S('Type', 'Proto | Fit | PP'),
      I('VersionNo', 'Version number within the type, e.g. 3'),
      S('Status', 'Submitted | Approved | Rejected - derived from the latest ApprovalRecord'),
      D('SubmittedAt', 'When this version was submitted to the buyer'),
      SA('EvidenceFileIds', 'Storage file ids for sample photos and tech packs'),
      S('Notes', 'Free-text notes on the version'),
    ],
  },
  {
    schemaName: 'ApprovalRecord',
    description: 'APPEND-ONLY. The decision of record on a sample version: who decided, what, when.',
    fields: [
      S('SampleVersionId', 'SampleVersion.ItemId'),
      S('StyleId', 'Style.ItemId, denormalised so the GM view need not join'),
      S('Decision', 'Approved | Rejected'),
      S('ActorId', 'IAM user id of the person who decided'),
      S('ActorName', 'Display name captured at decision time'),
      D('DecidedAt', 'Timestamp of the decision'),
      S('Note', 'Reason or comment attached to the decision'),
    ],
  },
  {
    schemaName: 'Issue',
    description: 'A sample comment or production defect tracked through its lifecycle.',
    fields: [
      S('Title', 'Short summary'),
      S('Description', 'Full description'),
      S('Type', 'Shade | Stitch | Measurement | Trim | Finishing | Other'),
      S('Severity', 'Critical | High | Medium | Low'),
      S('Status', 'Raised | Reviewed | CorrectionUnderWay | Corrected | Verified | Closed | Rejected'),
      S('StyleId', 'Style.ItemId'),
      S('LineId', 'Line.ItemId - empty for sampling issues not tied to a line'),
      S('BuyerId', 'Buyer.ItemId, denormalised for the GM view'),
      S('SampleVersionId', 'SampleVersion.ItemId when the issue came from a sample comment'),
      S('OwnerId', 'IAM user id of the assigned owner'),
      S('OwnerName', 'Display name of the owner'),
      S('Department', 'Pattern | Cutting | Dyeing | Sewing | Finishing | QA'),
      D('DueDate', 'When the correction is due'),
      /* When it was raised ON THE FLOOR, which is not when the row was written.
         CreatedDate is stamped by the gateway and cannot be supplied on insert,
         so a seeded or back-dated issue would otherwise claim to be from today
         and every "last 30 days" figure would really mean "since the import". */
      D('RaisedAt', 'When the issue was raised, as distinct from row creation'),
      S('RaisedBy', 'IAM user id of whoever raised it'),
      S('RaisedByName', 'Display name captured at raise time'),
      S('SourceCommentId', 'BuyerComment.ItemId when AI-derived'),
      D('ClosedAt', 'When it reached Closed'),
    ],
  },
  {
    schemaName: 'IssueEvent',
    description: 'APPEND-ONLY history. Who said what, who acted, when, with what evidence.',
    fields: [
      S('IssueId', 'Issue.ItemId'),
      S('Kind', 'Raised | Comment | StatusChange | Assigned | Evidence | Verified | Rejected'),
      S('ActorId', 'IAM user id of the actor'),
      S('ActorName', 'Display name captured at the time'),
      D('At', 'Timestamp of the event'),
      S('Message', 'What was said or done'),
      S('FromStatus', 'Previous status, for StatusChange'),
      S('ToStatus', 'New status, for StatusChange'),
      SA('EvidenceFileIds', 'Storage file ids attached to this event'),
    ],
  },
  {
    schemaName: 'BuyerComment',
    description: 'The raw buyer paragraph, as received. Input to the AI action list.',
    fields: [
      S('StyleId', 'Style.ItemId'),
      S('SampleVersionId', 'SampleVersion.ItemId the comment is about'),
      S('RawText', 'The buyer comment verbatim, often mixed Bangla and English'),
      S('Channel', 'Email | WhatsApp | TechPack'),
      D('ReceivedAt', 'When it arrived'),
      D('ParsedAt', 'When the AI produced an action list'),
      S('ParsedBy', 'Model or agent identifier that parsed it'),
    ],
  },
  {
    schemaName: 'ActionItem',
    description: 'One AI-proposed action from a buyer comment. Never official until a human accepts it.',
    fields: [
      S('BuyerCommentId', 'BuyerComment.ItemId'),
      S('IssueId', 'Issue.ItemId created once accepted - empty while proposed'),
      S('What', 'What to change'),
      S('Part', 'Which part of the garment, e.g. CB length, placket, collar tipping'),
      S('Department', 'Pattern | Cutting | Dyeing | Sewing | Finishing | QA'),
      S('Urgency', 'Critical | High | Medium | Low'),
      S('State', 'Proposed | Accepted | Edited | Rejected'),
      I('Sequence', 'Order within the parsed list'),
      S('AcceptedBy', 'IAM user id of the merchandiser who accepted it'),
      D('AcceptedAt', 'When it was accepted'),
    ],
  },
  {
    schemaName: 'RepeatAlert',
    description: 'Raised on the SECOND occurrence of the same defect on the same line, before the third.',
    fields: [
      S('LineId', 'Line.ItemId'),
      S('IssueType', 'The repeating Issue.Type'),
      I('WindowDays', 'Window the occurrences fell inside'),
      I('Occurrences', 'How many so far'),
      D('DetectedAt', 'When the pattern was detected'),
      SA('IssueIds', 'The issues that make up the pattern - the evidence trail'),
      S('Message', 'Human-readable warning'),
      B('Acknowledged', 'Whether the GM has acted on it'),
      S('AcknowledgedBy', 'IAM user id who acknowledged'),
    ],
  },
  {
    schemaName: 'CostAssumption',
    description: 'The brief’s own cost figures, seeded not hard-coded. Drives the GM cost impact.',
    fields: [
      S('Key', 'e.g. AirFreightPerKg', { isUniqueData: true }),
      F('Value', 'Numeric value'),
      S('Unit', 'e.g. USD/kg, pieces/hour, percent'),
      S('Note', 'Where the figure comes from in the brief'),
    ],
  },
];
