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

// Every origin the app can be served from. The deployed origin is the one Release
// issued for this project; lib/env.ts derives the callback from window.location, so
// a hostname that is not in this list produces "redirectUri is not registered for
// this client" at /idp/initiate, with the login button dead on the deployed site.
//
// Pass extra origins on the command line to register another domain:
//   node scripts/02-oidc-client.mjs https://garmentline.example.com
const DEPLOYED_ORIGIN = 'https://dbyfks-elhla.slsblx.com';
const EXTRA_ORIGINS = process.argv.slice(2).filter((a) => a.startsWith('http'));
const REDIRECT_URIS = [
  `http://localhost:${DEV_PORT}/login/callback`,
  `https://localhost:${DEV_PORT}/login/callback`,
  `https://garmentline.seliselocal.com/login/callback`,
  `https://garmentline.seliselocal.com:${DEV_PORT}/login/callback`,
  `${DEPLOYED_ORIGIN}/login/callback`,
  ...EXTRA_ORIGINS.map((o) => `${o.replace(/\/+$/, '')}/login/callback`),
];

// Saving an existing client REPLACES the whole document, so every field the save DTO
// knows about has to be carried forward or it silently resets to a default - which is
// how isAutoRedirect gets lost and IAM starts parking users on an interstitial page.
const SAVE_FIELDS = [
  'itemId', 'clientDisplayName', 'clientType', 'redirectUris', 'postLogoutRedirectUris',
  'allowedScopes', 'allowedResponseTypes', 'requirePkce', 'requireConsent',
  'frontChannelLogoutUri', 'backChannelLogoutUri', 'isAutoRedirect',
  'externalDiscoveryEndpoint', 'isActive', 'loginMode', 'useTokensCookie', 'requireMfa',
  'allowedMfaMethods', 'registerAsIdentityProvider', 'isDeviceFlowClient',
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
  /*
   * A client that already exists keeps whatever URIs it was created with - which is
   * why the first deployment's login failed: the hostname Release issued was not in
   * the list, and nothing here updated it. Union rather than replace, so re-running
   * after a redeploy never drops an origin someone registered by hand.
   */
  const union = [...new Set([...(client.redirectUris ?? []), ...REDIRECT_URIS])];
  const missing = union.filter((u) => !(client.redirectUris ?? []).includes(u));
  if (missing.length) {
    const body = Object.fromEntries(
      SAVE_FIELDS.filter((f) => client[f] !== undefined).map((f) => [f, client[f]]),
    );
    /* Never echo the stored secret back at the API. */
    await s.api('/iam/v4/oidc-clients', { body: { ...body, redirectUris: union } });
    console.log(`registered ${missing.length} new redirect URI(s):`);
    for (const u of missing) console.log(`  + ${u}`);
    await sleep(3000);
    client = (await listClients()).find((c) => c.clientDisplayName === CLIENT_NAME && c.isActive);
  } else {
    console.log('redirect URIs already up to date');
  }
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
