// Register the app's OIDC client and the Blocks identity provider behind it.
//
// Idempotent: reuses an existing client with the same display name unless --recreate.
// Writes generated/oidc-client.json and prints the VITE_BLOCKS_OIDC_CLIENT_ID to set.
//
//   node scripts/02-oidc-client.mjs [--recreate]
import fs from 'node:fs';
import path from 'node:path';
import { session, PROJECT_KEY, ROOT_DIR } from './blocks.mjs';

const CLIENT_NAME = 'GarmentLine';
const PROVIDER_NAME = 'garmentline-sso';
const DEV_PORT = 5173;

// Every origin the app could plausibly be served from, registered at once - adding one
// later costs a new client id and an env edit on every environment. No .slsblx.com entry
// yet: this project has no application domain until a deployment is set up, and the
// portal issues the hostname at that point.
const REDIRECT_URIS = [
  `http://localhost:${DEV_PORT}/login/callback`,
  `https://localhost:${DEV_PORT}/login/callback`,
  `https://garmentline.seliselocal.com/login/callback`,
  `https://garmentline.seliselocal.com:${DEV_PORT}/login/callback`,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const recreate = process.argv.includes('--recreate');
const s = await session();

const listClients = async () =>
  (await s.api('/iam/v4/oidc-clients', { method: 'GET' })).oIDCClientCredentials ?? [];
const listProviders = async () =>
  (await s.api('/iam/v4/auth/identity-providers', { method: 'GET' })).data ?? [];

let client = (await listClients()).find((c) => c.clientDisplayName === CLIENT_NAME && c.isActive);

if (client && recreate) {
  await s.api(`/iam/v4/oidc-clients/${client.clientId}`, { method: 'DELETE' });
  console.log(`deleted client ${client.clientId}`);
  client = null;
  await sleep(4000);
}

if (!client) {
  await s.api('/iam/v4/oidc-clients', {
    body: {
      audience: '',
      redirectUris: REDIRECT_URIS,
      scope: 'openid',
      isAutoRedirect: true,
      isActive: true,
      requirePkce: false,
      allowedResponseTypes: ['code'],
      allowedServiceAccessResources: ['blocks-iam', 'blocks-data', 'blocks-os', 'blocks-logic', 'blocks-monitor'],
      itemId: '',
      projectKey: PROJECT_KEY,
      clientBrandColor: '#1f6f43',
      clientDisplayName: CLIENT_NAME,
    },
  });
  console.log('created OIDC client');
  await sleep(4000);
  // POST returns only { itemId }; the secret has to be read back.
  client = (await listClients()).find((c) => c.clientDisplayName === CLIENT_NAME && c.isActive);
  if (!client) {
    console.error('client not found after create');
    process.exit(1);
  }
} else {
  console.log(`reusing client ${client.clientId}`);
}

const authMethod = client.tokenEndpointAuthMethod || 'client_secret_post';
console.log(`clientId    : ${client.clientId}`);
console.log(`authMethod  : ${authMethod}`);

/* ------------------------------------------------------- identity provider */
const providerBody = {
  displayName: 'Sign in with SELISE',
  providerType: 'blocks-oidc',
  protocol: 'oidc', // undocumented and mandatory: omitted, it 400s with Protocol_Is_Required
  provider: PROVIDER_NAME,
  clientId: client.clientId,
  clientSecret: client.clientSecret,
  audience: '',
  wellKnownUrl: `https://iam.seliseblocks.com/${PROJECT_KEY}/.well-known/openid-configuration`,
  tokenEndpointAuthMethod: authMethod, // must equal the client's, or /idp/callback 500s
  scope: 'openid',
  responseType: 'code',
  grantTypes: ['authorization_code', 'refresh_token'],
  redirectUris: REDIRECT_URIS,
  isActive: true,
  requirePkce: false,
  // Least privilege for anyone who arrives without a pre-provisioned account. Nobody
  // reaches an approval control by signing up; the GM promotes deliberately.
  initialRoles: ['qa-inspector'],
  initialPermissions: [],
};

await sleep(3000);
const existing = (await listProviders()).find((p) => p.provider === PROVIDER_NAME);
if (existing) {
  await s.api(`/iam/v4/auth/identity-providers/${existing.itemId ?? existing.id}`, {
    method: 'PUT', body: providerBody,
  });
  console.log(`updated identity provider ${PROVIDER_NAME}`);
} else {
  await s.api('/iam/v4/auth/identity-providers', { body: providerBody });
  console.log(`created identity provider ${PROVIDER_NAME}`);
}

/* --------------------------------------------------------------- smoke test */
await sleep(3000);
console.log('\nsmoke test - idp/initiate for every registered callback:');
let failures = 0;
for (const cb of REDIRECT_URIS) {
  const r = await s.raw(
    `/iam/v4/idp/initiate?x-blocks-key=${PROJECT_KEY}&clientId=${client.clientId}&redirectUri=${encodeURIComponent(cb)}`,
    { method: 'GET', projectKey: PROJECT_KEY },
  );
  const ok = Boolean(r.data?.redirect_uri);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${cb}${ok ? '' : ` - ${JSON.stringify(r.data).slice(0, 120)}`}`);
}

const out = path.join(ROOT_DIR, 'generated', 'oidc-client.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(
  { clientId: client.clientId, clientDisplayName: CLIENT_NAME, redirectUris: REDIRECT_URIS,
    provider: PROVIDER_NAME, tokenEndpointAuthMethod: authMethod }, null, 2));

console.log(`\nSet in .env.local:\n  VITE_BLOCKS_OIDC_CLIENT_ID=${client.clientId}`);
process.exit(failures ? 1 : 0);
