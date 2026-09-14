// Probe blocksai with the ACCOUNT token (not impersonated). Throwaway.
import { cloudLogin, call, APP_KEY, PROJECT_KEY } from './blocks.mjs';

const cloud = await cloudLogin();
console.log('cloud token ok, appKey=', APP_KEY?.slice(0, 8));

for (const key of [APP_KEY, PROJECT_KEY]) {
  console.log('--- key', key.slice(0, 8));
  for (const p of ['/blocksai-api/v1/agents', '/blocksai-api/v1/agents/models', '/blocksai-api/v1/models']) {
    try {
      const r = await call(p, { method: 'GET', token: cloud.access_token, projectKey: key, raw: true });
      const body = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data);
      console.log('GET', p, '->', r.status, body.slice(0, 200).replace(/\n/g, ' '));
    } catch (e) { console.log('GET', p, '-> THREW', e.message.slice(0, 120)); }
  }
}
