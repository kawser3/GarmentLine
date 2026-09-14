// PLAN §5: the demo case from the brief, as real rows.
//
// The one thing that must be exactly right: line 4 already carries TWO shade
// variation issues inside a ten-day window, and the RepeatAlert raised on the
// SECOND. The brief's demo logs a third during the presentation - the point is
// that the warning was already waiting before anyone asked for it.
//
//   node scripts/04-seed.mjs
import { session } from './blocks.mjs';
import { makeData } from './data.mjs';

const s = await session();
const db = makeData(s);

const now = Date.now();
const days = n => new Date(now - n * 86400e3).toISOString();
const ahead = n => new Date(now + n * 86400e3).toISOString();

// Wipe first so re-runs stay idempotent.
for (const c of ['Buyer','Style','Line','SampleVersion','ApprovalRecord','Issue',
                 'IssueEvent','BuyerComment','ActionItem','RepeatAlert','CostAssumption']) {
  const r = await db.deleteAll(c);
  process.stdout.write(`  purged ${c} (${r.totalImpactedData ?? 0})\n`);
}

/* ---------------------------------------------------------------- buyers */
const buyers = {};
for (const b of [
  { Name: 'Nordic Retail AB', Country: 'Sweden', ContactEmail: 'quality@nordicretail.example', PreferredLanguage: 'en', IsActive: true },
  { Name: 'Rue Belmont',      Country: 'France', ContactEmail: 'sourcing@ruebelmont.example',  PreferredLanguage: 'en', IsActive: true },
  { Name: 'Hafen Mode GmbH',  Country: 'Germany',ContactEmail: 'qa@hafenmode.example',         PreferredLanguage: 'en', IsActive: true },
]) buyers[b.Name] = await db.insert('Buyer', b);
console.log(`buyers: ${Object.keys(buyers).length}`);

/* ----------------------------------------------------------------- lines */
const lines = {};
for (let i = 1; i <= 8; i++) {
  lines[`Line ${i}`] = await db.insert('Line', {
    Name: `Line ${i}`, PlantId: 'Gazipur-1', SupervisorId: i === 4 ? 'rafiqul' : `sup-${i}`,
    WorkerCount: 750, IsActive: true,
  });
}
console.log(`lines: ${Object.keys(lines).length}`);

/* ---------------------------------------------------------------- styles */
const styles = {};
const styleDefs = [
  { StyleCode: 'ST-2451', Name: "Men's knit polo",        BuyerId: buyers['Nordic Retail AB'], Season: 'SS26', OrderQty: 12000, ShipDate: ahead(24), MerchandiserId: 'nusrat' },
  { StyleCode: 'ST-2460', Name: "Men's crew tee",         BuyerId: buyers['Nordic Retail AB'], Season: 'SS26', OrderQty: 18000, ShipDate: ahead(31), MerchandiserId: 'nusrat' },
  { StyleCode: 'ST-2477', Name: "Women's rib tank",       BuyerId: buyers['Rue Belmont'],      Season: 'SS26', OrderQty:  9000, ShipDate: ahead(18), MerchandiserId: 'nusrat' },
  { StyleCode: 'ST-2482', Name: "Kids' hooded sweat",     BuyerId: buyers['Hafen Mode GmbH'],  Season: 'AW26', OrderQty: 14000, ShipDate: ahead(45), MerchandiserId: 'shirin' },
  { StyleCode: 'ST-2490', Name: "Women's polo dress",     BuyerId: buyers['Rue Belmont'],      Season: 'SS26', OrderQty:  6500, ShipDate: ahead(12), MerchandiserId: 'shirin' },
];
for (const d of styleDefs) styles[d.StyleCode] = await db.insert('Style', { ...d, IsActive: true });
console.log(`styles: ${Object.keys(styles).length}`);

/* -------------------------------------------------------- sample versions */
// ST-2451 has walked proto -> fit -> PP. PP v1 and v2 were rejected; v3 is the
// one on the table tonight.
const ST = styles['ST-2451'];
const sv = {};
const svDefs = [
  { Type: 'Proto', VersionNo: 1, Status: 'Approved',  SubmittedAt: days(48), Notes: 'Proto accepted with minor comments.' },
  { Type: 'Fit',   VersionNo: 1, Status: 'Rejected',  SubmittedAt: days(40), Notes: 'Armhole too tight.' },
  { Type: 'Fit',   VersionNo: 2, Status: 'Approved',  SubmittedAt: days(33), Notes: 'Fit signed off.' },
  { Type: 'PP',    VersionNo: 1, Status: 'Rejected',  SubmittedAt: days(21), Notes: 'Collar tipping shading.' },
  { Type: 'PP',    VersionNo: 2, Status: 'Rejected',  SubmittedAt: days(12), Notes: 'CB length still short.' },
  { Type: 'PP',    VersionNo: 3, Status: 'Submitted', SubmittedAt: days(2),  Notes: 'Awaiting buyer decision.' },
];
for (const d of svDefs) {
  const key = `${d.Type}${d.VersionNo}`;
  sv[key] = await db.insert('SampleVersion', { ...d, StyleId: ST, EvidenceFileIds: [] });
}
console.log(`sample versions: ${Object.keys(sv).length}`);

/* ------------------------------------------------- approvals (append-only) */
const approvals = [
  { k: 'Proto1', Decision: 'Approved', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(46), Note: 'Proceed to fit.' },
  { k: 'Fit1',   Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(38), Note: 'Armhole tight, revise pattern.' },
  { k: 'Fit2',   Decision: 'Approved', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(31), Note: 'Fit approved by buyer.' },
  { k: 'PP1',    Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(19), Note: 'Collar tipping shows shading.' },
  { k: 'PP2',    Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(10), Note: 'CB length 1cm short.' },
];
await db.insertMany('ApprovalRecord', approvals.map(a => ({
  SampleVersionId: sv[a.k], StyleId: ST, Decision: a.Decision,
  ActorId: a.Actor, ActorName: a.Name, DecidedAt: a.at, Note: a.Note,
})));
console.log(`approval records: ${approvals.length}`);

/* ---------------------------------------------------------------- issues */
// The two that matter: shade variation on line 4, days -8 and -3.
const issueDefs = [
  { Title: 'Shade variation, front panel', Type: 'Shade', Severity: 'High', Status: 'Closed',
    Line: 'Line 4', Dept: 'Dyeing', raised: days(8), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Desc: 'Front panel shade off against approved swatch on roll 14.' },
  { Title: 'Shade variation, sleeve panel', Type: 'Shade', Severity: 'High', Status: 'Verified',
    Line: 'Line 4', Dept: 'Dyeing', raised: days(3), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Desc: 'Sleeve panels darker than body on lot B, same supplier dye lot.' },
  { Title: 'Broken stitch at side seam', Type: 'Stitch', Severity: 'Medium', Status: 'Closed',
    Line: 'Line 2', Dept: 'Sewing', raised: days(6), owner: 'sup-2', ownerName: 'Line 2 Supervisor',
    Desc: 'Skipped stitches on side seam, 40 pieces.' },
  { Title: 'CB length out of tolerance', Type: 'Measurement', Severity: 'Critical', Status: 'CorrectionUnderWay',
    Line: 'Line 1', Dept: 'Pattern', raised: days(4), owner: 'sup-1', ownerName: 'Line 1 Supervisor',
    Desc: 'Centre back length 1cm below spec across size M.' },
  { Title: 'Trim colour mismatch', Type: 'Trim', Severity: 'Low', Status: 'Closed',
    Line: 'Line 6', Dept: 'Finishing', raised: days(9), owner: 'sup-6', ownerName: 'Line 6 Supervisor',
    Desc: 'Zipper tape slightly off tone.' },
  { Title: 'Neck rib wavy after wash', Type: 'Finishing', Severity: 'Medium', Status: 'Reviewed',
    Line: 'Line 3', Dept: 'Finishing', raised: days(2), owner: 'sup-3', ownerName: 'Line 3 Supervisor',
    Desc: 'Neck rib waving on washed samples.' },
];
const issueIds = [];
for (const d of issueDefs) {
  const id = await db.insert('Issue', {
    Title: d.Title, Description: d.Desc, Type: d.Type, Severity: d.Severity, Status: d.Status,
    StyleId: ST, LineId: lines[d.Line], BuyerId: buyers['Nordic Retail AB'], SampleVersionId: '',
    OwnerId: d.owner, OwnerName: d.ownerName, Department: d.Dept,
    DueDate: ahead(3), RaisedBy: 'qa-01', RaisedByName: 'QA Inspector',
    SourceCommentId: '', ClosedAt: d.Status === 'Closed' ? d.raised : null,
  });
  issueIds.push({ id, ...d });
  await db.insertMany('IssueEvent', [
    { IssueId: id, Kind: 'Raised', ActorId: 'qa-01', ActorName: 'QA Inspector', At: d.raised,
      Message: d.Desc, FromStatus: '', ToStatus: 'Raised', EvidenceFileIds: [] },
    { IssueId: id, Kind: 'StatusChange', ActorId: d.owner, ActorName: d.ownerName, At: d.raised,
      Message: `Moved to ${d.Status}.`, FromStatus: 'Raised', ToStatus: d.Status, EvidenceFileIds: [] },
  ]);
}
console.log(`issues: ${issueIds.length} (+ ${issueIds.length * 2} events)`);

/* ------------------------------------------------- the repeat alert, early */
const shade = issueIds.filter(i => i.Type === 'Shade');
await db.insert('RepeatAlert', {
  LineId: lines['Line 4'], IssueType: 'Shade', WindowDays: 10, Occurrences: shade.length,
  DetectedAt: days(3), IssueIds: shade.map(i => i.id), Acknowledged: false, AcknowledgedBy: '',
  Message: 'Shade variation has now been recorded twice on Line 4 within 10 days. ' +
           'Same dye supplier both times. Raise a corrective action before the third occurrence.',
});
console.log('repeat alert: raised on the 2nd occurrence (Line 4 / Shade)');

/* -------------------------------------------------- the messy buyer comment */
await db.insert('BuyerComment', {
  StyleId: ST, SampleVersionId: sv['PP3'],
  RawText: 'body length thik ache but CB length 1cm kom lagche, placket ektu wide, ' +
           'collar tipping e shading dekha jacche. PP approve korar age eigulo thik korte hobe. ' +
           'Shipment date can not move, please confirm by Thursday.',
  Channel: 'Email', ReceivedAt: days(1), ParsedAt: null, ParsedBy: '',
});
console.log('buyer comment: seeded unparsed (the demo parses it live)');

/* ------------------------------------------------------- cost assumptions */
await db.insertMany('CostAssumption', [
  { Key: 'AirFreightPerKg',    Value: 4.0,  Unit: 'USD/kg',       Note: 'Brief: air freight ~$4/kg' },
  { Key: 'SeaFreightPerKg',    Value: 0.40, Unit: 'USD/kg',       Note: 'Brief: sea freight $0.40/kg' },
  { Key: 'ReworkPiecesPerHour',Value: 12,   Unit: 'pieces/hour',  Note: 'Brief: ~12 pieces per hour per line' },
  { Key: 'ChargebackMinPct',   Value: 2,    Unit: 'percent',      Note: 'Brief: buyer chargeback 2-5% of order value' },
  { Key: 'ChargebackMaxPct',   Value: 5,    Unit: 'percent',      Note: 'Brief: buyer chargeback 2-5% of order value' },
  { Key: 'AvgGarmentWeightKg', Value: 0.22, Unit: 'kg',           Note: 'Knit polo, used to convert pieces to freight weight' },
]);
console.log('cost assumptions: 6 (from the brief, not hard-coded)');

console.log('\nseed complete.');
