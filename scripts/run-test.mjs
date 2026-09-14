/**
 * Run one TypeScript test file under node.
 *
 * There is no test framework here on purpose. Every test in this project is a plain script
 * that throws on a failed assertion, so the only thing missing is TypeScript stripping and
 * import resolution — which esbuild already does, and which vite already ships. Adding vitest
 * would pull a test runner, a jsdom, and a config file to run five files that need none of it.
 *
 * Factored out of package.json (where blocks-finance inlines the whole esbuild invocation per
 * test) so the bundle flags live in one place rather than being copy-pasted per script.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = process.argv[2];

if (!entry) {
  console.error("usage: node scripts/run-test.mjs <path/to/file.test.ts>");
  process.exit(2);
}

const outdir = path.join(root, "node_modules", ".cache", "tests");
mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, path.basename(entry).replace(/\.ts$/, ".mjs"));

await build({
  entryPoints: [path.resolve(root, entry)],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  // The `@/` alias is a vite/tsconfig concern; esbuild needs telling separately or a test
  // importing `@/lib/utils` fails to resolve with a message that never mentions the alias.
  alias: { "@": path.join(root, "src") },
});

await import(pathToFileURL(outfile).href);
