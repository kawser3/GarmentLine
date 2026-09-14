// Minimal Blocks v4 API client. No /api prefix anywhere - see PLAN §01.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').replace(/\r/g, '');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export const env = loadEnv();
export const API = env.BLOCKS_API_URL;
export const PROJECT_KEY = process.env.PROJECT_KEY || 'D6fce8ccb4e064ae49f0f6b1ab30f88e8'; // GarmentLine dev
// x-blocks-key resolves a registered *application*, not the tenant - the tenant
// comes from the token. The cloud tenant's app key is the one that resolves for
// every service, so we send it everywhere and let the impersonated token scope
// the data. (Sending the project tenant id here yields a bare 401.)
// Resolved from the cloud-login JWT's tenant_id rather than pasted: it is this
// ACCOUNT's tenant, and hardcoding it hid that fact once already. Sending the
// PROJECT tenant here is not a loud failure - admin routes 401, but runtime
// routes answer 200 with the OTHER tenant's data. Verified 2026-09-14.
export let APP_KEY = process.env.APP_KEY || '';
export const ROOT_DIR = ROOT;

export async function call(pathname, { method = 'POST', body, token, projectKey, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof URLSearchParams) && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (projectKey) h['x-blocks-key'] = projectKey;
  const res = await fetch(API + pathname, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' || body instanceof URLSearchParams ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data = text;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { try { data = JSON.parse(text); } catch { /* keep text */ } }
  if (raw) return { status: res.status, ok: res.ok, data, text, ct };
  if (!res.ok) {
    const err = new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 800)}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  // The /api trap in reverse: a 200 that is actually the SPA shell.
  if (typeof data === 'string' && /<!doctype html|<html/i.test(data)) {
    throw new Error(`${method} ${pathname} -> 200 but returned SPA HTML (wrong route)`);
  }
  return data;
}

export async function cloudLogin() {
  const d = await call('/iam/v4/auth-login', {
    body: { grant_type: 'password', username: env.BLOCKS_USERNAME, password: env.BLOCKS_PASSWORD },
  });
  if (!d.access_token) throw new Error('cloud login returned no access_token');
  if (!APP_KEY) {
    APP_KEY = JSON.parse(Buffer.from(d.access_token.split('.')[1], 'base64url').toString()).tenant_id;
  }
  return d;
}

// --- Project tenant session -------------------------------------------------
// Impersonated tokens live ~10 min and the refresh token is single-use, so we
// re-impersonate from a fresh cloud login rather than caching one token.

export async function listProjects() {
  const cloud = await cloudLogin();
  const claims = JSON.parse(Buffer.from(cloud.access_token.split('.')[1], 'base64url').toString());
  const groups = await call('/os/v4/Project/Gets?Page=0&PageSize=100', {
    method: 'GET', token: cloud.access_token, projectKey: claims.tenant_id,
  });
  return groups.flatMap(g => g.projects);
}

export const BLOCKS_CLI_CLIENT_ID = '4a633b13-1108-4fbf-84fd-b196c9dcdee2';

// Impersonating into a project tenant needs three things that are easy to get
// wrong: x-blocks-key must be the CLOUD tenant (not the target), a client_id is
// mandatory ("Client configuration not found" otherwise), and the refresh token
// is single-use - so each call starts from a fresh cloud login.
export async function impersonate(tenantId = PROJECT_KEY) {
  const cloud = await cloudLogin();
  const claims = JSON.parse(Buffer.from(cloud.access_token.split('.')[1], 'base64url').toString());
  const d = await call('/iam/v4/auth/impersonate', {
    token: cloud.access_token,
    projectKey: claims.tenant_id,
    body: {
      targeted_tenant_id: tenantId,
      organization_id: 'default',
      refresh_token: cloud.refresh_token,
      client_id: BLOCKS_CLI_CLIENT_ID,
    },
  });
  if (!d.access_token) throw new Error('impersonate returned no access_token: ' + JSON.stringify(d).slice(0, 400));
  return d;
}

// A session that transparently re-impersonates when the token nears expiry.
export async function session(tenantId = PROJECT_KEY) {
  let tok = null, exp = 0;
  const fresh = async () => {
    if (!tok || Date.now() > exp - 60_000) {
      const d = await impersonate(tenantId);
      tok = d.access_token;
      const c = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
      exp = c.exp * 1000;
    }
    return tok;
  };
  return {
    tenantId,
    token: fresh,
    claims: async () => JSON.parse(Buffer.from((await fresh()).split('.')[1], 'base64url').toString()),
    async api(pathname, opts = {}) {
      return call(pathname, { ...opts, token: await fresh(), projectKey: opts.projectKey ?? APP_KEY });
    },
    async raw(pathname, opts = {}) {
      return call(pathname, { ...opts, token: await fresh(), projectKey: opts.projectKey ?? APP_KEY, raw: true });
    },
    // Every read and write goes through the one GraphQL endpoint. Queries are
    // get<Plural> (getIncidents) returning { items, totalCount, pageNo,
    // pageSize, totalPages, hasNextPage }; mutations are insert/update/delete
    // <Name> plus their ...Many variants.
    async gql(query, variables) {
      const r = await call('/data/v4/gateway', {
        token: await fresh(), projectKey: APP_KEY, body: { query, variables }, raw: true,
      });
      if (r.data?.errors?.length) {
        throw new Error('GraphQL: ' + r.data.errors.map(e => e.message).join(' | ') +
          '\n  query: ' + query.replace(/\s+/g, ' ').slice(0, 240));
      }
      if (!r.ok) throw new Error(`gateway ${r.status}: ${r.text.slice(0, 400)}`);
      return r.data.data;
    },
  };
}
