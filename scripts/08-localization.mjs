// Push the bundled dictionary to the Blocks Localization service.
//
// The app ships a bundled dictionary so the first paint is never blank, and
// overlays whatever the service returns on top (src/features/i18n/i18n.tsx).
// Until this script existed the overlay had nothing to fetch: the service held
// none of GarmentLine's keys, so the "Localization" line in the service map was
// a fetch that always came back empty.
//
// The bundle stays the source of truth for WHICH keys exist — the overlay drops
// a service key the types do not know — and the service becomes the source of
// truth for what each one SAYS. That is the split that lets a translator fix a
// word in বাংলা without a rebuild.
//
//   node scripts/08-localization.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { session, ROOT_DIR } from './blocks.mjs';

const MODULE_NAME = 'garmentline';
const PREFIX = 'gl.';                       // must match SERVICE_KEY_PREFIX in i18n
const CULTURES = ['en-US', 'bn-BD'];
const dryRun = process.argv.includes('--dry-run');

/* ------------------------------------------------- read the bundled dictionary */

/*
 * Parsed out of the TypeScript rather than imported: this is a plain .mjs script
 * and the dictionary is a .ts module. The file's shape is strictly one
 * "key": "value" pair per entry, so a scan is exact — and it fails loudly below
 * if either block comes back short, rather than pushing a half dictionary.
 */
function readDictionaries() {
  const src = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'features', 'i18n', 'dictionary.ts'), 'utf8');
  const cut = (marker, end) => {
    const from = src.indexOf(marker);
    if (from === -1) throw new Error(`dictionary.ts: '${marker}' not found`);
    const to = end ? src.indexOf(end, from) : src.length;
    return src.slice(from, to === -1 ? src.length : to);
  };
  const parse = (block) => {
    const out = {};
    const re = /"([\w.\-]+)":\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(block))) out[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return out;
  };
  const en = parse(cut('export const enUS = {', 'export const bnBD'));
  const bn = parse(cut('export const bnBD: Dict = {', 'export const LOCALES'));
  return { en, bn };
}

const { en, bn } = readDictionaries();
const keyNames = Object.keys(en);
if (keyNames.length < 50) throw new Error(`only ${keyNames.length} en-US keys parsed - refusing to push`);
const missing = keyNames.filter((k) => !(k in bn));
if (missing.length) throw new Error(`bn-BD is missing ${missing.length} key(s): ${missing.slice(0, 5)}`);
console.log(`dictionary: ${keyNames.length} keys x ${CULTURES.length} cultures`);

const s = await session();
/*
 * No projectKey override. x-blocks-key resolves a registered APPLICATION, not a
 * tenant — the tenant comes from the impersonated token — so sending the project
 * tenant id here answers a bare 401 with no body, which is exactly how this
 * script first failed on Module/Save while the read routes shrugged it off.
 */
const api = (p, body) => s.api(`/localization/v4/${p}`, { body });
/* The list routes take no body, and a body makes them a POST — which this
   service answers with the SPA shell rather than an error. */
const apiGet = (p) => s.api(`/localization/v4/${p}`, { method: 'GET' });

/* -------------------------------------------------------------- languages */

const langRes = await apiGet('Language/Gets').catch(() => ({}));
const langList = Array.isArray(langRes) ? langRes : (langRes.languages ?? langRes.data ?? []);
const haveLangs = new Set(
  langList
    .map((l) => (l.languageCode ?? l.code ?? l.culture ?? '').toLowerCase())
    .filter(Boolean),
);
for (const culture of CULTURES) {
  if (haveLangs.has(culture.toLowerCase())) { console.log(`language ${culture}: present`); continue; }
  if (dryRun) { console.log(`language ${culture}: WOULD create`); continue; }
  await api('Language/Save', { languageCode: culture, languageName: culture, isActive: true })
    .then(() => console.log(`language ${culture}: created`))
    .catch((e) => console.log(`language ${culture}: not created (${String(e.message).slice(0, 80)})`));
}

/* ----------------------------------------------------------------- module */

async function findModule() {
  const r = await apiGet('Module/Gets').catch(() => []);
  /* Answers with a bare array; the envelope shapes are kept as a fallback
     because the sibling routes on this service do use them. */
  const list = Array.isArray(r) ? r : (r.modules ?? r.data ?? []);
  return list.find(
    (m) => String(m.moduleName ?? m.name ?? '').toLowerCase() === MODULE_NAME);
}
let mod = await findModule();
if (!mod) {
  if (dryRun) {
    console.log(`module ${MODULE_NAME}: WOULD create`);
  } else {
    await api('Module/Save', { moduleName: MODULE_NAME });
    mod = await findModule();
    if (!mod) throw new Error(`module '${MODULE_NAME}' saved but could not be resolved`);
    console.log(`module ${MODULE_NAME}: created`);
  }
} else {
  console.log(`module ${MODULE_NAME}: reusing ${mod.itemId}`);
}
const moduleId = mod?.itemId ?? '';

/* ------------------------------------------------------------------- keys */

/*
 * Key/SaveKeys ASSIGNS the request's resources over the stored ones instead of
 * merging, so a push that carried one culture would wipe the other. Both go in
 * the same request, and anything else the stored key holds (routes, glossary
 * links, context) is read back and carried forward.
 */
const serviceNames = keyNames.map((k) => PREFIX + k);
const existing = new Map();
if (moduleId) {
  for (let i = 0; i < serviceNames.length; i += 200) {
    const chunk = serviceNames.slice(i, i + 200);
    const r = await api('Key/GetsByKeyNames', { keyNames: chunk, moduleId }).catch(() => ({}));
    const rows = Array.isArray(r) ? r : (Object.values(r).find(Array.isArray) ?? []);
    for (const row of rows) if (row?.keyName) existing.set(row.keyName, row);
  }
}
console.log(`service already holds ${existing.size} of ${serviceNames.length} keys`);

const payload = keyNames.map((k) => {
  const name = PREFIX + k;
  const current = existing.get(name) ?? {};
  return {
    ...(current.itemId ? { itemId: current.itemId } : {}),
    keyName: name,
    moduleId,
    context: current.context ?? 'GarmentLine UI string',
    routes: current.routes ?? [],
    glossaryIds: current.glossaryIds ?? [],
    resources: [
      { culture: 'en-US', value: en[k] },
      { culture: 'bn-BD', value: bn[k] },
    ],
    shouldPublish: true,
  };
});

if (dryRun) {
  console.log(`\n--dry-run: would save ${payload.length} keys (${existing.size} updated, ${payload.length - existing.size} new)`);
  console.log('sample:', JSON.stringify(payload[0], null, 2).slice(0, 420));
  process.exit(0);
}

let saved = 0;
for (let i = 0; i < payload.length; i += 100) {
  const batch = payload.slice(i, i + 100);
  await api('Key/SaveKeys', batch);
  saved += batch.length;
  console.log(`  saved ${saved}/${payload.length}`);
}

/* ---------------------------------------------------------------- verify */

const check = await api('Key/Gets', {});
const ours = (check.keys ?? []).filter((k) => k.keyName?.startsWith(PREFIX));
const withBoth = ours.filter((k) => {
  const c = new Set((k.resources ?? []).filter((r) => r.value).map((r) => r.culture));
  return CULTURES.every((x) => c.has(x));
}).length;
console.log(`\nservice now holds ${ours.length} ${PREFIX}* keys; ${withBoth} carry both cultures`);
console.log(ours.length === keyNames.length && withBoth === keyNames.length
  ? 'localization push complete.'
  : '! counts differ from the bundle - inspect before relying on the overlay.');
