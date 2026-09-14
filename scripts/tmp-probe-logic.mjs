// Probe the Logic + AI service surface. Throwaway.
import { session } from './blocks.mjs';

const s = await session();
const tok = await s.token();
console.log('session ok, appKey=', s.appKey ?? '(via api)', 'token len', tok.length);

const probes = [
  ['/logic/v4/Workflow/Gets', {}],
  ['/logic/v4/Workflow/Run', {}],
  ['/logic/v4/Agent/Gets', {}],
  ['/ai/v4/Agent/Gets', {}],
  ['/ai/v4/Agents', {}],
  ['/utilities/v4/AI/Gets', {}],
];

for (const [p, body] of probes) {
  try {
    const r = await s.raw(p, { method: 'POST', body });
    const preview = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data);
    console.log(p, '->', r.status, r.ct?.slice(0, 30), preview.slice(0, 300).replace(/\n/g, ' '));
  } catch (e) {
    console.log(p, '-> THREW', e.message.slice(0, 160));
  }
}
