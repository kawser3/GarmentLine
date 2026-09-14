// The brief closes on two questions. If this script cannot answer them from the
// gateway alone, the demo cannot either.
import { session } from './blocks.mjs';
import { makeData } from './data.mjs';

const s = await session();
const db = makeData(s);
let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log('\nQ1. Which sample version is approved?');
const style = (await db.query('Style', { where: { StyleCode: { eq: 'ST-2451' } }, fields: 'ItemId StyleCode Name OrderQty' })).items[0];
ok(!!style, `style ST-2451 found (${style?.Name}, ${style?.OrderQty} pcs)`);
const versions = await db.all('SampleVersion', { where: { StyleId: { eq: style.ItemId } }, fields: 'ItemId Type VersionNo Status SubmittedAt' });
const records = await db.all('ApprovalRecord', { where: { StyleId: { eq: style.ItemId } }, fields: 'SampleVersionId Decision ActorName DecidedAt Note' });
for (const v of versions.sort((a, b) => new Date(a.SubmittedAt) - new Date(b.SubmittedAt))) {
  const r = records.filter(x => x.SampleVersionId === v.ItemId).sort((a, b) => new Date(b.DecidedAt) - new Date(a.DecidedAt))[0];
  console.log(`     ${(v.Type + ' v' + v.VersionNo).padEnd(9)} ${v.Status.padEnd(10)}` +
    (r ? ` <- ${r.Decision} by ${r.ActorName} on ${r.DecidedAt.slice(0, 10)}` : ' <- no decision of record yet'));
}
const pp = versions.filter(v => v.Type === 'PP').sort((a, b) => b.VersionNo - a.VersionNo)[0];
ok(pp?.VersionNo === 3 && pp.Status === 'Submitted', 'PP v3 is the open decision (approved live in the demo)');
ok(records.length === 5, `${records.length} approval records, each stamped with a person and a time`);

console.log('\nQ2. What is line 4 doing to our delivery date?');
const line4 = (await db.query('Line', { where: { Name: { eq: 'Line 4' } }, fields: 'ItemId Name' })).items[0];
const alerts = await db.all('RepeatAlert', { where: { LineId: { eq: line4.ItemId } }, fields: 'IssueType Occurrences WindowDays DetectedAt IssueIds Message Acknowledged' });
const a = alerts[0];
ok(!!a, 'a repeat alert exists for Line 4');
ok(a?.Occurrences === 2, `raised at occurrence ${a?.Occurrences} - BEFORE the third, per the enhancement challenge`);
ok((a?.IssueIds ?? []).length === 2, `evidence trail carries ${(a?.IssueIds ?? []).length} issue ids`);
console.log(`     detected ${a?.DetectedAt?.slice(0, 10)}: ${a?.Message?.slice(0, 90)}...`);

console.log('\nSupporting state');
for (const [n, want] of [['Buyer', 3], ['Style', 5], ['Line', 8], ['Issue', 6], ['IssueEvent', 12], ['CostAssumption', 6]]) {
  const c = await db.count(n, {});
  ok(c === want, `${n}: ${c}`);
}
const bc = (await db.query('BuyerComment', { fields: 'RawText ParsedAt' })).items[0];
ok(bc && !bc.ParsedAt, 'buyer comment seeded UNPARSED - the AI parses it live on stage');

console.log(bad ? `\n${bad} check(s) failed.` : '\nall checks passed.');
process.exit(bad ? 1 : 0);
