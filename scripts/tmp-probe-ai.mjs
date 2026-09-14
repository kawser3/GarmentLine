// Probe the blocksai-api surface. Throwaway.
import { session, PROJECT_KEY, APP_KEY } from './blocks.mjs';

const s = await session();
const tok = await s.token();
console.log('token ok len', tok.length);

async function tryCall(method, path, body, key) {
  const r = await s.raw(path, {
    method, body, projectKey: key,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
  });
  const p = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data);
  return `${r.status} ${r.ct.slice(0, 24)} ${p.slice(0, 220).replace(/\n/g, ' ')}`;
}

for (const key of [PROJECT_KEY, APP_KEY].filter(Boolean)) {
  console.log('--- x-blocks-key:', key.slice(0, 8) + '…');
  for (const [m, p, b] of [
    ['GET', '/blocksai-api/v1/agents'],
    ['GET', '/blocksai-api/v1/models'],
    ['GET', '/blocksai-api/v1/agents/models'],
    ['GET', '/blocksai-api/v1/usages/quota-utilisations'],
  ]) {
    try { console.log(m, p, '->', await tryCall(m, p, undefined, key)); }
    catch (e) { console.log(m, p, '-> THREW', e.message.slice(0, 140)); }
  }
}
