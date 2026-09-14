// PLAN §3: the roles, their permissions, and the demo users the brief names.
//
//   node scripts/03-roles-users.mjs
import fs from 'node:fs';
import path from 'node:path';
import { session, ROOT_DIR } from './blocks.mjs';
import { permissions, roles, demoUsers, DEMO_PASSWORD, RESOURCE_GROUP } from './iam-model.mjs';

const s = await session();
const log = (...a) => console.log(...a);

// ---- permissions -----------------------------------------------------------
const existingPerms = new Map();
{
  const r = await s.api('/iam/v4/iam/permissions', { body: { page: 0, pageSize: 500 } });
  for (const p of r.data || []) existingPerms.set(p.resource, p);
}
log(`existing permissions in tenant: ${existingPerms.size}`);

for (const p of permissions) {
  if (existingPerms.has(p.resource)) { log(`  = ${p.resource}`); continue; }
  try {
    await s.api('/iam/v4/iam/permissions/create', {
      body: {
        name: p.name,
        type: 1,
        description: p.description,
        resource: p.resource,
        resourceGroup: RESOURCE_GROUP,
        tags: [],
        dependentPermissions: [],
        isBuiltIn: false,
        permissionSeverity: p.permissionSeverity,
      },
    });
    log(`  + ${p.resource}`);
  } catch (e) {
    log(`  ! ${p.resource} -> ${e.message.slice(0, 220)}`);
  }
}

// Re-read: the ids of anything just created are not in the map above, and
// assign-permissions resolves by id.
{
  const r = await s.api('/iam/v4/iam/permissions', { body: { page: 0, pageSize: 500 } });
  existingPerms.clear();
  for (const p of r.data || []) existingPerms.set(p.resource, p);
}

// ---- roles -----------------------------------------------------------------
const existingRoles = new Map();
{
  const r = await s.api('/iam/v4/iam/roles', { body: { page: 0, pageSize: 200 } });
  for (const x of r.data || []) existingRoles.set(x.slug, x);
}
log(`\nexisting roles: ${[...existingRoles.keys()].join(', ')}`);

for (const role of roles) {
  if (!existingRoles.has(role.slug)) {
    try {
      await s.api('/iam/v4/iam/roles/create', {
        body: {
          name: role.name,
          description: role.description,
          slug: role.slug,
          canCreateOwn: false,
          confirmDuplicateName: true,
        },
      });
      log(`  + role ${role.slug}`);
    } catch (e) {
      log(`  ! role ${role.slug} -> ${e.message.slice(0, 220)}`);
      continue;
    }
  } else {
    log(`  = role ${role.slug}`);
  }

  /*
   * assign-permissions takes permission ITEM IDS, not resource strings.
   *
   * Handed a resource string it answers {"success":true} and attaches NOTHING —
   * the silent failure that matters most here, because every screen keeps working
   * (the app gates on role slugs from the token) while the server-side model is
   * quietly empty. Resolve to ids first, and verify afterwards.
   */
  const wanted = [...role.permissions, ...(role.extra ?? [])];
  const ids = [];
  const unknown = [];
  for (const resource of wanted) {
    const rec = existingPerms.get(resource);
    if (rec?.itemId) ids.push(rec.itemId);
    else unknown.push(resource);
  }
  if (unknown.length) log(`    ! not found: ${unknown.join(', ')}`);

  /*
   * Strip whatever the role holds that the model does not name. Without this the
   * script only ever ADDS, so a permission granted by hand — or by an earlier
   * version of this file — survives every re-run and the model stops describing
   * reality.
   */
  const stale = [...existingPerms.values()]
    .filter((perm) => (perm.roles || []).includes(role.slug) && !wanted.includes(perm.resource))
    .map((perm) => perm.itemId);
  if (stale.length) log(`    - removing ${stale.length} permission(s) the model no longer grants`);

  try {
    await s.api('/iam/v4/iam/roles/assign-permissions', {
      body: {
        slug: role.slug,
        addPermissions: ids,
        removePermissions: stale,
        organizationId: 'default',
        propagateToAllOrganizations: false,
      },
    });
  } catch (e) {
    log(`    ! assign -> ${e.message.slice(0, 260)}`);
  }
}

// Read the model back. A success response is not evidence here — see above.
{
  const after = await s.api('/iam/v4/iam/permissions', { body: { page: 0, pageSize: 500 } });
  log('');
  for (const role of roles) {
    const held = (after.data || []).filter((p) => (p.roles || []).includes(role.slug)).length;
    const want = role.permissions.length + (role.extra?.length ?? 0);
    log(`  ${held === want ? 'ok  ' : 'MISMATCH'} ${role.slug.padEnd(18)} ${held}/${want} permissions attached`);
  }
}

// ---- demo users ------------------------------------------------------------
// A user is created inactive and unverified, so it cannot sign in until
// /iam/v4/iam/users/activate runs - do not skip that second call.
// The enum fields are validated with NotEmpty, so 0 is rejected outright:
// userPassType and userCreationType must both be >= 1.
log('\ndemo users:');
const existingUsers = new Map();
{
  const r = await s.api('/iam/v4/iam/users', { body: { page: 0, pageSize: 200 } });
  for (const x of r.data || []) existingUsers.set(x.email, x);
}

const created = [];
for (const u of demoUsers) {
  let userId = existingUsers.get(u.email)?.itemId ?? null;
  if (userId) {
    log(`  = ${u.email.padEnd(46)} ${u.role.padEnd(18)} ${userId}`);
  } else {
    try {
      const r = await s.api('/iam/v4/iam/users/create', {
        body: {
          email: u.email,
          userName: u.email,
          password: DEMO_PASSWORD,
          firstName: u.firstName,
          lastName: u.lastName,
          userPassType: 1,
          userCreationType: 1,
          verifiedType: 1,
          mfaEnabled: false,
          roles: [u.role],
          permissions: [],
          organizationId: 'default',
          language: 'en',
        },
      });
      userId = r?.itemId || r?.userId || null;
      log(`  + ${u.email.padEnd(46)} ${u.role.padEnd(18)} ${userId ?? ''}`);
    } catch (e) {
      log(`  ! ${u.email.padEnd(46)} ${e.message.slice(0, 200)}`);
    }
  }

  if (userId) {
    try {
      await s.api('/iam/v4/iam/users/activate', { body: { userId, reason: 'demo account' } });
    } catch (e) {
      // Already active is the normal case on a re-run, not a failure.
      if (!/already active/i.test(e.message)) log(`    ! activate -> ${e.message.slice(0, 160)}`);
    }
  }
  created.push({ ...u, userId });
}

// Read the users back so the seed can reference real IAM ids.
const back = await s.api('/iam/v4/iam/users', { body: { page: 0, pageSize: 100 } });
const byEmail = new Map((back.data || []).map(x => [x.email, x]));
for (const c of created) {
  const rec = byEmail.get(c.email);
  if (rec) { c.userId = rec.itemId || rec.userId; c.active = rec.active ?? rec.isActive; }
}

const out = path.join(ROOT_DIR, 'generated', 'demo-users.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ password: DEMO_PASSWORD, users: created }, null, 2));

log(`\ntotal users in tenant: ${back.totalCount}`);
log(`credentials written -> generated/demo-users.json (password: ${DEMO_PASSWORD})`);
