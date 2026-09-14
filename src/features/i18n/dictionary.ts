/**
 * The two dictionaries the portal renders from.
 *
 * English is the source of truth for the KEY SET: `enUS` is declared `as const` and
 * `bnBD` is typed as `Dict`, so a key that exists in English and not in Bangla FAILS
 * THE BUILD rather than surfacing an English word inside a Bangla sentence at runtime.
 *
 * Bangla rather than a European second language on purpose: the people who read the
 * floor screens - line supervisors and QA - work in Bangla, and the brief's own buyer
 * comment arrives as mixed Bangla and English.
 *
 * The same keys are pushed to the Blocks localization service under the `garmentline`
 * module (scripts/08-localization.mjs), prefixed `gl.` because the service returns every
 * key on the tenant and the browser must pick ours out without knowing a module GUID.
 * The bundle renders immediately; the service overlays when it answers.
 *
 * What deliberately has NO key: issue free text, history entries, buyer comments,
 * style and buyer names. Those are records, not chrome - restating them in another
 * language is authorship, and an append-only trail must not depend on a UI setting.
 */

export const enUS = {
  /* -- shell -------------------------------------------------------------- */
  "nav.group.production": "Production",
  "nav.group.configuration": "Configuration",
  "nav.dashboard": "Management view",
  "nav.issues": "Issues",
  "nav.samples": "Samples",
  "nav.people": "People",
  "nav.master": "Master data",
  "shell.signedIn": "Signed in",
  "shell.defaultRole": "No role",
  "shell.signOut": "Sign out",
  "shell.changePassword": "Change password",
  "shell.openNav": "Open navigation",
  "shell.closeNav": "Close navigation",
  "shell.collapseNav": "Collapse navigation",
  "shell.expandNav": "Expand navigation",
  "shell.pageFoot": "GarmentLine · sample approval and production issue tracking",

  /* -- common ------------------------------------------------------------- */
  "common.all": "All",
  "common.and": "and",
  "common.or": "or",
  "common.search": "Search",
  "common.clearSearch": "Clear search",
  "common.reset": "Reset",
  "common.filtered": "filtered",
  "common.record.one": "record",
  "common.record.many": "records",

  /* -- auth --------------------------------------------------------------- */
  "auth.signIn.title": "Sign in to GarmentLine",
  "auth.signIn.body": "Sample approvals and production issues for the styles you own.",
  "auth.signIn.button": "Sign in",
  "auth.signIn.forgot": "Forgot password?",
  "auth.signIn.redirecting": "Redirecting to sign in...",
  "auth.signIn.errorTitle": "Sign-in failed",
  "auth.signIn.notConfigured": "Sign-in is not configured",
  "auth.signIn.notConfiguredBodyA": "This build has no identity provider set.",
  "auth.signIn.notConfiguredBodyB": "Set the OIDC client id in the environment,",
  "auth.signIn.notConfiguredBodyC": "then reload this page.",
  "auth.session.checking": "Checking your session...",
  "auth.callback.working": "Completing sign in...",
  "auth.callback.failed": "Sign-in could not be completed",
  "auth.callback.noCode": "The identity provider returned no authorisation code.",
  "auth.callback.back": "Back to sign in",
  "auth.role.deniedTitle": "You do not have access to this page",
  "auth.role.needs": "This page needs",
  "auth.role.holds": "You hold",
  "auth.role.holdsNone": "no roles",
  "auth.role.startPage": "Go to your start page",

  "role.superadmin": "Super Administrator",
  "role.admin": "Administrator",
  "role.factory-manager": "Factory Manager",
  "role.merchandiser": "Merchandiser",
  "role.line-supervisor": "Line Supervisor",
  "role.qa-inspector": "QA Inspector",
  "role.buyer": "Buyer",
} as const;

export type Dict = Record<keyof typeof enUS, string>;
export type DictKey = keyof typeof enUS;

export const bnBD: Dict = {
  "nav.group.production": "উৎপাদন",
  "nav.group.configuration": "কনফিগারেশন",
  "nav.dashboard": "ম্যানেজমেন্ট ভিউ",
  "nav.issues": "ইস্যু",
  "nav.samples": "স্যাম্পল",
  "nav.people": "ইউজার",
  "nav.master": "মাস্টার ডাটা",
  "shell.signedIn": "সাইন ইন করা আছে",
  "shell.defaultRole": "কোনো রোল নেই",
  "shell.signOut": "সাইন আউট",
  "shell.changePassword": "পাসওয়ার্ড পরিবর্তন",
  "shell.openNav": "মেনু খুলুন",
  "shell.closeNav": "মেনু বন্ধ করুন",
  "shell.collapseNav": "মেনু সঙ্কুচিত করুন",
  "shell.expandNav": "মেনু প্রসারিত করুন",
  "shell.pageFoot": "GarmentLine · স্যাম্পল অনুমোদন ও উৎপাদন ইস্যু ট্র্যাকিং",
  "common.all": "সব",
  "common.and": "এবং",
  "common.or": "অথবা",
  "common.search": "খুঁজুন",
  "common.clearSearch": "সার্চ মুছুন",
  "common.reset": "রিসেট",
  "common.filtered": "ফিল্টার করা",
  "common.record.one": "রেকর্ড",
  "common.record.many": "রেকর্ড",
  "auth.signIn.title": "GarmentLine এ সাইন ইন করুন",
  "auth.signIn.body": "আপনার স্টাইলের স্যাম্পল অনুমোদন ও উৎপাদন ইস্যু।",
  "auth.signIn.button": "সাইন ইন",
  "auth.signIn.forgot": "পাসওয়ার্ড ভুলে গেছেন?",
  "auth.signIn.redirecting": "সাইন ইন এ পাঠানো হচ্ছে...",
  "auth.signIn.errorTitle": "সাইন ইন ব্যর্থ হয়েছে",
  "auth.signIn.notConfigured": "সাইন ইন কনফিগার করা হয়নি",
  "auth.signIn.notConfiguredBodyA": "এই বিল্ডে কোনো আইডেন্টিটি প্রোভাইডার সেট করা নেই।",
  "auth.signIn.notConfiguredBodyB": "এনভায়রনমেন্টে OIDC ক্লায়েন্ট আইডি দিন,",
  "auth.signIn.notConfiguredBodyC": "তারপর পেজটি রিলোড করুন।",
  "auth.session.checking": "সেশন যাচাই করা হচ্ছে...",
  "auth.callback.working": "সাইন ইন সম্পন্ন হচ্ছে...",
  "auth.callback.failed": "সাইন ইন সম্পন্ন করা যায়নি",
  "auth.callback.noCode": "আইডেন্টিটি প্রোভাইডার কোনো অথরাইজেশন কোড দেয়নি।",
  "auth.callback.back": "সাইন ইন এ ফিরে যান",
  "auth.role.deniedTitle": "এই পেজে আপনার অ্যাকসেস নেই",
  "auth.role.needs": "এই পেজের জন্য প্রয়োজন",
  "auth.role.holds": "আপনার আছে",
  "auth.role.holdsNone": "কোনো রোল নেই",
  "auth.role.startPage": "আপনার শুরুর পেজে যান",

  "role.superadmin": "সুপার অ্যাডমিনিস্ট্রেটর",
  "role.admin": "অ্যাডমিনিস্ট্রেটর",
  "role.factory-manager": "ফ্যাক্টরি ম্যানেজার",
  "role.merchandiser": "মার্চেন্ডাইজার",
  "role.line-supervisor": "লাইন সুপারভাইজার",
  "role.qa-inspector": "কিউএ ইন্সপেক্টর",
  "role.buyer": "বায়ার",
};

export const LOCALES = ["en-US", "bn-BD"] as const;
export type Locale = (typeof LOCALES)[number];

export const DICTIONARIES: Record<Locale, Dict> = {
  "en-US": enUS,
  "bn-BD": bnBD,
};

export const SERVICE_KEY_PREFIX = "gl.";
