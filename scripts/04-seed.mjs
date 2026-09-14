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
// A real floor is not eight identical lines: crews differ by product, and the
// heavy-knit lines on Floor 2 run smaller. Line 4 is Rafiqul's - the repeat-defect
// story below plays out there, so it has to be a line with a named owner.
const LINE_DEFS = [
  { Name: 'Line 1', Plant: 'Gazipur-1 · Floor 1', Sup: 'sup-anwar',   Crew: 62 },
  { Name: 'Line 2', Plant: 'Gazipur-1 · Floor 1', Sup: 'sup-parvin',  Crew: 58 },
  { Name: 'Line 3', Plant: 'Gazipur-1 · Floor 1', Sup: 'sup-jahangir',Crew: 64 },
  { Name: 'Line 4', Plant: 'Gazipur-1 · Floor 2', Sup: 'rafiqul',     Crew: 71 },
  { Name: 'Line 5', Plant: 'Gazipur-1 · Floor 2', Sup: 'sup-momena',  Crew: 68 },
  { Name: 'Line 6', Plant: 'Gazipur-1 · Floor 2', Sup: 'sup-shafiq',  Crew: 55 },
  { Name: 'Line 7', Plant: 'Gazipur-2 · Floor 1', Sup: 'sup-rubel',   Crew: 49 },
  { Name: 'Line 8', Plant: 'Gazipur-2 · Floor 1', Sup: 'sup-nazma',   Crew: 52 },
];
const lines = {};
for (const l of LINE_DEFS) {
  lines[l.Name] = await db.insert('Line', {
    Name: l.Name, PlantId: l.Plant, SupervisorId: l.Sup, WorkerCount: l.Crew, IsActive: true,
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
// one on the table tonight. The other styles carry shorter histories so the
// samples register reads like a factory, not a single-style demo.
const ST = styles['ST-2451'];
const sv = {};
const svDefs = [
  // ST-2451 — the demo style.
  { key: 'Proto1', Style: 'ST-2451', Type: 'Proto', VersionNo: 1, Status: 'Approved',  SubmittedAt: days(48), Notes: 'Proto accepted with minor comments.' },
  { key: 'Fit1',   Style: 'ST-2451', Type: 'Fit',   VersionNo: 1, Status: 'Rejected',  SubmittedAt: days(40), Notes: 'Armhole too tight.' },
  { key: 'Fit2',   Style: 'ST-2451', Type: 'Fit',   VersionNo: 2, Status: 'Approved',  SubmittedAt: days(33), Notes: 'Fit signed off.' },
  { key: 'PP1',    Style: 'ST-2451', Type: 'PP',    VersionNo: 1, Status: 'Rejected',  SubmittedAt: days(21), Notes: 'Collar tipping shading.' },
  { key: 'PP2',    Style: 'ST-2451', Type: 'PP',    VersionNo: 2, Status: 'Rejected',  SubmittedAt: days(12), Notes: 'CB length still short.' },
  { key: 'PP3',    Style: 'ST-2451', Type: 'PP',    VersionNo: 3, Status: 'Submitted', SubmittedAt: days(2),  Notes: 'Awaiting buyer decision.' },
  // The rest of the order book, at various gates.
  { key: '2460Fit1', Style: 'ST-2460', Type: 'Fit', VersionNo: 1, Status: 'Approved',  SubmittedAt: days(20), Notes: 'Fit signed off first pass.' },
  { key: '2460PP1',  Style: 'ST-2460', Type: 'PP',  VersionNo: 1, Status: 'Submitted', SubmittedAt: days(3),  Notes: 'PP on the table.' },
  { key: '2477P1',   Style: 'ST-2477', Type: 'Proto', VersionNo: 1, Status: 'Rejected', SubmittedAt: days(25), Notes: 'Rib quality not acceptable.' },
  { key: '2477P2',   Style: 'ST-2477', Type: 'Proto', VersionNo: 2, Status: 'Approved', SubmittedAt: days(15), Notes: 'Approved after rib change.' },
  { key: '2482Fit1', Style: 'ST-2482', Type: 'Fit', VersionNo: 1, Status: 'Approved',  SubmittedAt: days(10), Notes: 'Approved.' },
  { key: '2490PP1',  Style: 'ST-2490', Type: 'PP',  VersionNo: 1, Status: 'Rejected',  SubmittedAt: days(6),  Notes: 'Hem uneven.' },
  { key: '2490PP2',  Style: 'ST-2490', Type: 'PP',  VersionNo: 2, Status: 'Submitted', SubmittedAt: days(1),  Notes: 'Resubmitted after hem correction.' },
];
for (const d of svDefs) {
  sv[d.key] = await db.insert('SampleVersion', {
    Type: d.Type, VersionNo: d.VersionNo, Status: d.Status, SubmittedAt: d.SubmittedAt,
    Notes: d.Notes, StyleId: styles[d.Style], EvidenceFileIds: [],
  });
}
console.log(`sample versions: ${Object.keys(sv).length}`);

/* ------------------------------------------------- approvals (append-only) */
const approvals = [
  { k: 'Proto1', Decision: 'Approved', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(46), Note: 'Proceed to fit.' },
  { k: 'Fit1',   Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(38), Note: 'Armhole tight, revise pattern.' },
  { k: 'Fit2',   Decision: 'Approved', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(31), Note: 'Fit approved by buyer.' },
  { k: 'PP1',    Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(19), Note: 'Collar tipping shows shading.' },
  { k: 'PP2',    Decision: 'Rejected', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(10), Note: 'CB length 1cm short.' },
  { k: '2460Fit1', Decision: 'Approved', Actor: 'nusrat', Name: 'Nusrat Jahan', at: days(18), Note: 'Fit approved.' },
  { k: '2477P1',   Decision: 'Rejected', Actor: 'shirin', Name: 'Shirin Akter', at: days(23), Note: 'Rib quality poor.' },
  { k: '2477P2',   Decision: 'Approved', Actor: 'shirin', Name: 'Shirin Akter', at: days(13), Note: 'Rib changed, approved.' },
  { k: '2482Fit1', Decision: 'Approved', Actor: 'shirin', Name: 'Shirin Akter', at: days(8), Note: 'Approved.' },
  { k: '2490PP1',  Decision: 'Rejected', Actor: 'shirin', Name: 'Shirin Akter', at: days(4), Note: 'Hem uneven; resubmit.' },
];
await db.insertMany('ApprovalRecord', approvals.map(a => ({
  SampleVersionId: sv[a.k], StyleId: styles[svDefs.find(d => d.key === a.k).Style],
  Decision: a.Decision, ActorId: a.Actor, ActorName: a.Name, DecidedAt: a.at, Note: a.Note,
})));
console.log(`approval records: ${approvals.length}`);

/* ---------------------------------------------------------------- issues */
// The two that matter: shade variation on line 4, days -8 and -3. The rest are
// spread across buyers, lines and types over the trailing month, so the GM's
// view has a real distribution to rank instead of one story.
const NORDIC = buyers['Nordic Retail AB'], RUE = buyers['Rue Belmont'], HAFEN = buyers['Hafen Mode GmbH'];
const issueDefs = [
  { Title: 'Shade variation, front panel', Type: 'Shade', Severity: 'High', Status: 'Closed',
    Line: 'Line 4', Dept: 'Dyeing', raised: days(8), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Front panel shade off against approved swatch on roll 14.' },
  { Title: 'Shade variation, sleeve panel', Type: 'Shade', Severity: 'High', Status: 'Verified',
    Line: 'Line 4', Dept: 'Dyeing', raised: days(3), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Sleeve panels darker than body on lot B, same supplier dye lot.' },
  { Title: 'CB length out of tolerance', Type: 'Measurement', Severity: 'Critical', Status: 'CorrectionUnderWay',
    Line: 'Line 1', Dept: 'Pattern', raised: days(4), owner: 'sup-anwar', ownerName: 'Anwar Hossain',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Centre back length 1cm below spec across size M.' },
  { Title: 'Broken stitch at side seam', Type: 'Stitch', Severity: 'Medium', Status: 'Closed',
    Line: 'Line 2', Dept: 'Sewing', raised: days(6), owner: 'sup-parvin', ownerName: 'Parvin Akter',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Skipped stitches on side seam, 40 pieces.' },
  { Title: 'Fabric hole on roll 3', Type: 'Other', Severity: 'High', Status: 'Verified',
    Line: 'Line 1', Dept: 'Cutting', raised: days(13), owner: 'sup-anwar', ownerName: 'Anwar Hossain',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Hole detected at spreading; roll quarantined.' },
  { Title: 'Shade batch difference, body lots', Type: 'Shade', Severity: 'Medium', Status: 'Closed',
    Line: 'Line 6', Dept: 'Dyeing', raised: days(18), owner: 'sup-shafiq', ownerName: 'Shafiqul Haque',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Two dye lots one shade apart; shade card tightened.' },
  { Title: 'Press mark on collar', Type: 'Finishing', Severity: 'Low', Status: 'Closed',
    Line: 'Line 8', Dept: 'Finishing', raised: days(27), owner: 'sup-nazma', ownerName: 'Nazma Khatun',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Press marking visible on dark collars.' },
  { Title: 'Neck rib wavy after wash', Type: 'Finishing', Severity: 'Medium', Status: 'Reviewed',
    Line: 'Line 3', Dept: 'Finishing', raised: days(2), owner: 'sup-jahangir', ownerName: 'Jahangir Alam',
    Style: 'ST-2477', Buyer: RUE,
    Desc: 'Neck rib waving on washed samples.' },
  { Title: 'Sleeve length variation', Type: 'Measurement', Severity: 'High', Status: 'Corrected',
    Line: 'Line 5', Dept: 'Cutting', raised: days(11), owner: 'sup-momena', ownerName: 'Momena Begum',
    Style: 'ST-2477', Buyer: RUE,
    Desc: 'Sleeve cuts 0.5cm short after relaxation; marker revised.' },
  { Title: 'Sleeve cuff twill curling', Type: 'Finishing', Severity: 'Low', Status: 'Verified',
    Line: 'Line 2', Dept: 'Finishing', raised: days(9), owner: 'sup-parvin', ownerName: 'Parvin Akter',
    Style: 'ST-2477', Buyer: RUE,
    Desc: 'Cuff twill curls after pressing.' },
  { Title: 'Chest tight at armhole', Type: 'Measurement', Severity: 'High', Status: 'Corrected',
    Line: 'Line 3', Dept: 'Pattern', raised: days(7), owner: 'sup-jahangir', ownerName: 'Jahangir Alam',
    Style: 'ST-2490', Buyer: RUE,
    Desc: 'Chest 1.5cm under spec; pattern adjusted.' },
  { Title: 'Label placement off', Type: 'Trim', Severity: 'Low', Status: 'Closed',
    Line: 'Line 8', Dept: 'Finishing', raised: days(20), owner: 'sup-nazma', ownerName: 'Nazma Khatun',
    Style: 'ST-2490', Buyer: RUE,
    Desc: 'Care label 1cm low on 200 pieces.' },
  { Title: 'Needle break contamination check', Type: 'Other', Severity: 'Critical', Status: 'Closed',
    Line: 'Line 7', Dept: 'Sewing', raised: days(15), owner: 'sup-rubel', ownerName: 'Rubel Mia',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Needle break at station 4; pieces through metal detector.' },
  { Title: 'Overlock width uneven', Type: 'Stitch', Severity: 'Medium', Status: 'Closed',
    Line: 'Line 7', Dept: 'Sewing', raised: days(23), owner: 'sup-rubel', ownerName: 'Rubel Mia',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Overlock seam width varies beyond tolerance.' },
  { Title: 'Drawcord tip fraying', Type: 'Trim', Severity: 'Medium', Status: 'Reviewed',
    Line: 'Line 5', Dept: 'Finishing', raised: days(5), owner: 'sup-momena', ownerName: 'Momena Begum',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Cord tips fray after tip machine; plastic tips ordered.' },
  { Title: 'Zipper tape colour mismatch', Type: 'Trim', Severity: 'Low', Status: 'Closed',
    Line: 'Line 6', Dept: 'Finishing', raised: days(9), owner: 'sup-shafiq', ownerName: 'Shafiqul Haque',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Tape slightly off tone against approved trim card.' },

  /*
   * A second fortnight of traffic, so the management view ranks a real spread
   * rather than a near-tie. Line 4 carries the most (it is the line the repeat
   * story runs on) and Nordic the most by buyer, because they hold the two
   * biggest orders on the book.
   *
   * NOTE for anyone adding rows: any further Shade issue on Line 4 must be
   * raised OUTSIDE the 10-day repeat window, or the RepeatAlert below stops
   * saying "2 occurrences" and the demo's headline number drifts.
   */
  { Title: 'Neck tape twisting after wash', Type: 'Finishing', Severity: 'High', Status: 'Verified',
    Line: 'Line 4', Dept: 'Finishing', raised: days(6), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Neck tape twists 3-4mm after wash on 120 pieces; tape tension reset.' },
  { Title: 'Shoulder seam puckering', Type: 'Stitch', Severity: 'Medium', Status: 'CorrectionUnderWay',
    Line: 'Line 4', Dept: 'Sewing', raised: days(2), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Puckering at shoulder join on size L; differential feed adjusted.' },
  { Title: 'Shade band variation, body fabric', Type: 'Shade', Severity: 'High', Status: 'Closed',
    Line: 'Line 4', Dept: 'Dyeing', raised: days(26), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Edge-to-centre shade band on rolls 22-24; lot segregated before cutting.' },
  { Title: 'Bottom hem roping', Type: 'Finishing', Severity: 'Medium', Status: 'Corrected',
    Line: 'Line 4', Dept: 'Finishing', raised: days(17), owner: 'rafiqul', ownerName: 'Rafiqul Islam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Hem ropes on coverstitch at high speed; operator retrained.' },
  { Title: 'Armhole measurement drift', Type: 'Measurement', Severity: 'High', Status: 'Reviewed',
    Line: 'Line 1', Dept: 'Pattern', raised: days(2), owner: 'sup-anwar', ownerName: 'Anwar Hossain',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Armhole 0.8cm over spec from size L upward.' },
  { Title: 'Print placement high on chest', Type: 'Other', Severity: 'Medium', Status: 'Corrected',
    Line: 'Line 2', Dept: 'Finishing', raised: days(12), owner: 'sup-parvin', ownerName: 'Parvin Akter',
    Style: 'ST-2460', Buyer: NORDIC,
    Desc: 'Chest print sits 1.5cm above the placement sheet on 80 pieces.' },
  { Title: 'Buttonhole fraying at placket', Type: 'Trim', Severity: 'High', Status: 'Verified',
    Line: 'Line 3', Dept: 'Sewing', raised: days(14), owner: 'sup-jahangir', ownerName: 'Jahangir Alam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Buttonhole edges fray on polo placket; cutter blade replaced.' },
  { Title: 'Collar point length uneven', Type: 'Measurement', Severity: 'Medium', Status: 'Closed',
    Line: 'Line 3', Dept: 'Sewing', raised: days(21), owner: 'sup-jahangir', ownerName: 'Jahangir Alam',
    Style: 'ST-2451', Buyer: NORDIC,
    Desc: 'Left and right collar points differ by 2mm on 60 pieces.' },
  { Title: 'Pilling on rib after wash test', Type: 'Other', Severity: 'High', Status: 'CorrectionUnderWay',
    Line: 'Line 5', Dept: 'QA', raised: days(4), owner: 'sup-momena', ownerName: 'Momena Begum',
    Style: 'ST-2477', Buyer: RUE,
    Desc: 'Rib pills at grade 3 after five wash cycles; yarn lot under review.' },
  { Title: 'Side seam twist on finished piece', Type: 'Stitch', Severity: 'Medium', Status: 'Reviewed',
    Line: 'Line 6', Dept: 'Sewing', raised: days(3), owner: 'sup-shafiq', ownerName: 'Shafiqul Haque',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Side seam rotates 2cm toward front after wash.' },
  { Title: 'Hood drawcord length short', Type: 'Measurement', Severity: 'Low', Status: 'Closed',
    Line: 'Line 6', Dept: 'Finishing', raised: days(19), owner: 'sup-shafiq', ownerName: 'Shafiqul Haque',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Cord 4cm under spec after tipping.' },
  { Title: 'Care label language set incomplete', Type: 'Trim', Severity: 'Medium', Status: 'Corrected',
    Line: 'Line 8', Dept: 'Finishing', raised: days(10), owner: 'sup-nazma', ownerName: 'Nazma Khatun',
    Style: 'ST-2490', Buyer: RUE,
    Desc: 'German care text missing from the label set on first 300 pieces.' },
  { Title: 'Pocket bag fabric substitution', Type: 'Other', Severity: 'Critical', Status: 'Raised',
    Line: 'Line 7', Dept: 'Cutting', raised: days(1), owner: 'sup-rubel', ownerName: 'Rubel Mia',
    Style: 'ST-2482', Buyer: HAFEN,
    Desc: 'Pocket bag cut from unapproved lot; quantity being traced.' },
  { Title: 'Seam slippage at side panel', Type: 'Stitch', Severity: 'High', Status: 'Raised',
    Line: 'Line 8', Dept: 'Sewing', raised: days(1), owner: 'sup-nazma', ownerName: 'Nazma Khatun',
    Style: 'ST-2490', Buyer: RUE,
    Desc: 'Seam slips under 3kg pull on the side panel join.' },
];
const issueIds = [];
for (const d of issueDefs) {
  const id = await db.insert('Issue', {
    Title: d.Title, Description: d.Desc, Type: d.Type, Severity: d.Severity, Status: d.Status,
    StyleId: styles[d.Style], LineId: lines[d.Line], BuyerId: d.Buyer, SampleVersionId: '',
    OwnerId: d.owner, OwnerName: d.ownerName, Department: d.Dept,
    RaisedAt: d.raised, DueDate: ahead(3), RaisedBy: 'qa-01', RaisedByName: 'QA Inspector',
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
