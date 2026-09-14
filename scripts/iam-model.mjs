// The access model from PLAN §3, as Blocks IAM permissions.
//
// Capability answers WHAT MAY I DO; scope answers TO WHICH RECORDS. They are separate:
// these are capability only, and the scope filter lives in features/issues/scope.ts and
// is applied to every read.
//
// The line the brief draws: "Only authorized people can mark a sample 'approved' - this
// is a decision of record, not a casual status." So sample::approve is its own permission
// and the line supervisor does not hold it. A supervisor who could stamp a sample could
// start bulk against a version the buyer never signed off, which is the failure the whole
// product exists to prevent.

export const RESOURCE_GROUP = 'garmentline';

const p = (resource, name, description, severity = 0) =>
  ({ resource: `${RESOURCE_GROUP}::${resource}`, name, description, permissionSeverity: severity });

export const permissions = [
  // -- platform ------------------------------------------------------------
  p('platform::roles', 'Manage roles and permissions', 'Create and edit roles, assign permissions.', 4),
  p('people::manage', 'Invite, grant and suspend', 'Invite users, change roles, suspend accounts.', 4),
  p('masterdata::manage', 'Manage master data', 'Buyers, styles and lines.', 3),

  // -- issue lifecycle -----------------------------------------------------
  p('issue::read', 'View issues', "Read issues within the caller's scope.", 0),
  p('issue::raise', 'Raise an issue', 'Log a sample comment or a production defect.', 1),
  p('issue::progress', 'Move through the lifecycle', 'Review, correct, and record what was done.', 2),
  p('issue::verify', 'Verify a correction', "QA's confirmation that the fix holds.", 2),
  p('issue::close', 'Close an issue', 'Settle it once verified.', 2),

  // -- samples: the decision of record -------------------------------------
  p('sample::read', 'View sample versions', 'Read the version history and its decisions.', 0),
  p('sample::approve', 'Approve or reject a sample', 'A decision of record, stamped with a person and a time.', 4),

  // -- AI action list ------------------------------------------------------
  p('action::accept', 'Accept AI action items', 'Turn a proposed action into an owned issue.', 2),

  // -- management ----------------------------------------------------------
  p('management::view', 'See the management view', 'Aggregates by buyer, line and issue type.', 1),
  p('management::cost', 'See cost impact', 'Delay and chargeback exposure. The brief gives this to the GM.', 3),
  p('alert::acknowledge', 'Acknowledge a repeat-defect alert', 'Record that the pattern has been acted on.', 2),
];

/** Which roles hold which permission, by resource suffix. */
const grants = {
  'platform::roles': ['superadmin', 'admin'],
  'people::manage': ['superadmin', 'admin', 'factory-manager'],
  'masterdata::manage': ['superadmin', 'admin', 'factory-manager', 'merchandiser'],
  'issue::read': ['superadmin', 'admin', 'factory-manager', 'merchandiser', 'line-supervisor', 'qa-inspector'],
  'issue::raise': ['superadmin', 'admin', 'factory-manager', 'merchandiser', 'line-supervisor', 'qa-inspector'],
  'issue::progress': ['superadmin', 'admin', 'factory-manager', 'merchandiser', 'line-supervisor', 'qa-inspector'],
  'issue::verify': ['superadmin', 'admin', 'factory-manager', 'qa-inspector'],
  'issue::close': ['superadmin', 'admin', 'factory-manager', 'merchandiser'],
  'sample::read': ['superadmin', 'admin', 'factory-manager', 'merchandiser', 'line-supervisor', 'qa-inspector'],
  'sample::approve': ['superadmin', 'admin', 'factory-manager', 'merchandiser'],
  'action::accept': ['superadmin', 'admin', 'factory-manager', 'merchandiser'],
  'management::view': ['superadmin', 'admin', 'factory-manager', 'merchandiser'],
  'management::cost': ['superadmin', 'admin', 'factory-manager'],
  'alert::acknowledge': ['superadmin', 'admin', 'factory-manager'],
};

for (const perm of permissions) {
  perm.roles = grants[perm.resource.replace(`${RESOURCE_GROUP}::`, '')] ?? [];
}

export const roles = [
  { slug: 'superadmin', name: 'Super Administrator', description: 'Platform owner: holds every permission, including role and people management.', permissions: [] },
  { slug: 'admin', name: 'Administrator', description: 'Changes the rules: roles, permissions, access.', permissions: [] },
  { slug: 'factory-manager', name: 'Factory Manager', description: 'Sees everything including cost impact.', permissions: [] },
  { slug: 'merchandiser', name: 'Merchandiser', description: 'Owns buyers and styles; approves samples.', permissions: [] },
  { slug: 'line-supervisor', name: 'Line Supervisor', description: 'Runs lines; records corrections. Cannot approve a sample.', permissions: [] },
  { slug: 'qa-inspector', name: 'QA Inspector', description: 'Checks samples and output; verifies corrections.', permissions: [] },
  { slug: 'buyer', name: 'Buyer', description: 'External. Reads the approval report for their own styles.', permissions: [] },
];

/*
 * The single source of truth is the grants map above: each role's permission list is
 * derived from it, so the model cannot drift into the state where the script reads an
 * empty list and silently strips everything server-side.
 */
for (const role of roles) {
  role.permissions = permissions
    .filter((perm) => perm.roles.includes(role.slug))
    .map((perm) => perm.resource);
}

export const DEMO_PASSWORD = 'GarmentLine#2026';

// The people the brief names, plus a GM, an admin, and the platform owner.
export const demoUsers = [
  { email: 'nusrat.garmentline@example.com', firstName: 'Nusrat', lastName: 'Jahan', role: 'merchandiser' },
  { email: 'rafiqul.garmentline@example.com', firstName: 'Rafiqul', lastName: 'Islam', role: 'line-supervisor' },
  { email: 'qa.garmentline@example.com', firstName: 'Shamima', lastName: 'Akter', role: 'qa-inspector' },
  { email: 'gm.garmentline@example.com', firstName: 'Anwar', lastName: 'Hossain', role: 'factory-manager' },
  { email: 'owner.garmentline@example.com', firstName: 'Tahmid', lastName: 'Rahman', role: 'superadmin' },
];
