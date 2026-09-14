// Grant a role to an existing IAM user in the app tenant.
//
//   node scripts/06-grant-role.mjs <email> <role-slug> [more slugs...]
//
// /iam/v4/iam/users/access REPLACES the whole role list for the organization,
// so the current list is read first and the new slug is appended to it.
import { session } from './blocks.mjs';

const [email, ...slugs] = process.argv.slice(2);
if (!email || !slugs.length) {
  console.error('usage: node scripts/06-grant-role.mjs <email> <role-slug>...');
  process.exit(1);
}

const s = await session();

const list = await s.api('/iam/v4/iam/users', { body: { page: 0, pageSize: 300 } });
const user = (list.data || []).find((u) => u.email === email);
if (!user) {
  console.error(`no IAM user with email ${email} in this tenant. Users:`);
  for (const u of list.data || []) console.error('  ', u.email);
  process.exit(1);
}
const userId = user.itemId || user.userId;

// GET the same view /users/access resolves, so nothing is dropped by the replace.
const current = await s.raw(`/iam/v4/iam/users/${encodeURIComponent(userId)}`, { method: 'GET' });
const currentRoles = Array.isArray(current.data?.roles)
  ? current.data.roles
  : Array.isArray(user.roles)
    ? (user.roles.length && typeof user.roles[0] === 'string' ? user.roles : Object.values(user.roles).flat())
    : [];

const merged = [...new Set([...currentRoles, ...slugs])];
console.log(`${email}: roles ${JSON.stringify(currentRoles)} -> ${JSON.stringify(merged)}`);

await s.api('/iam/v4/iam/users/access', {
  body: { userId, roles: merged, permissions: [], organizationId: 'default' },
});
console.log('granted. Sign out and back in to pick up the new token claims.');
