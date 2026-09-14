// The buyer-facing sample-decision email. Idempotent: re-running replaces the body.
//
//   node scripts/05-mail-template.mjs [--test]
//
// Placeholders are PascalCase {{Mustache}} tokens; the app passes
// subjectDataContext/bodyDataContext with the same keys via Mail/SendToAny.
import { session } from './blocks.mjs';

const NAME = 'GarmentLineSampleDecision';

const SUBJECT = '{{Decision}}: {{StyleCode}} {{SampleLabel}}';

const BODY = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1b2021;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <div style="font-size:15px;font-weight:700;">GarmentLine</div>
      <div style="font-size:12px;color:#64748b;">Sample approval — decision of record</div>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 12px;">Dear {{BuyerName}},</p>
      <p style="margin:0 0 16px;">
        Sample <strong>{{StyleCode}} {{SampleLabel}}</strong> has been
        <strong>{{Decision}}</strong>.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;border:1px solid #e2e8f0;border-radius:6px;">
        <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Decision</td>
            <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e2e8f0;">{{Decision}}</td></tr>
        <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Recorded by</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">{{DecidedBy}}</td></tr>
        <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Recorded at</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">{{DecidedAt}}</td></tr>
        <tr><td style="padding:8px 12px;color:#64748b;">Open production issues on this style</td>
            <td style="padding:8px 12px;">{{OpenIssues}}</td></tr>
      </table>
      {{NoteBlock}}
      <p style="margin:16px 0 0;font-size:12px;color:#64748b;">
        This message records a decision already stamped in the GarmentLine register.
        The approval of record is the latest entry there; email is notice, not the register.
      </p>
    </td></tr>
  </table>
</body>
</html>`;

const s = await session();

// Idempotency: same-name template in the same language is replaced, not duplicated.
const existing = await s.raw('/os/v4/Mail/GetTemplates', { method: 'GET' });
const prior = (existing.data.templates ?? []).find((t) => t.name === NAME && t.language === 'en-US');

// A template must name its mail configuration or every send 400s with
// "purpose and language combination does not have a registered email server".
const cfgs = await s.raw('/os/v4/Mail/Gets', { method: 'GET' });
const defaultCfg = (Array.isArray(cfgs.data) ? cfgs.data : []).find((c) => c.isDefault);
if (!defaultCfg) throw new Error('no default mail configuration found');

const saved = await s.api('/os/v4/Mail/SaveTemplate', {
  method: 'POST',
  body: {
    ...(prior?.itemId ? { itemId: prior.itemId } : {}),
    name: NAME,
    language: 'en-US',
    mailConfigurationId: defaultCfg.itemId ?? defaultCfg.id,
    templateSubject: SUBJECT,
    templateBody: BODY,
  },
});
console.log(prior ? `updated template ${NAME} (${prior.itemId})` : `created template ${NAME}`, saved);

if (process.argv.includes('--test')) {
  const sent = await s.api('/logic/v4/Mail/SendToAny', {
    method: 'POST',
    body: {
      to: ['harun.kawser@selisegroup.com'],
      purpose: NAME,
      language: 'en-US',
      isTestMail: true,
      subjectDataContext: {
        Decision: 'Approved', StyleCode: 'ST-2451', SampleLabel: 'PP v3',
      },
      bodyDataContext: {
        BuyerName: 'Marta Kowalski', StyleCode: 'ST-2451', SampleLabel: 'PP v3',
        Decision: 'Approved', DecidedBy: 'Nusrat Jahan (Merchandiser)',
        DecidedAt: new Date().toISOString(), OpenIssues: '2',
        NoteBlock: '<p style="margin:12px 0 0;font-size:13px;">Note: proceed with bulk on receipt of this approval.</p>',
      },
    },
  });
  console.log('test mail ->', JSON.stringify(sent).slice(0, 200));
}
