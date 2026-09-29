/**
 * Module resolution hooks for running the app's TypeScript under plain
 * `node --test` (registered by `tests/register.mjs`).
 *
 *  - `@/x` resolves to `src/x.ts`, `src/x.mts` or `src/x/index.ts` (the
 *    `paths` alias from tsconfig.json).
 *  - Extensionless relative imports (`./store`, `../db/defaults`) resolve to
 *    the matching `.ts` file or `index.ts`, the way the bundler does.
 *  - `server-only`, `next/headers`, `next/navigation`, `next/cache` and `next/server` are
 *    replaced by the small fakes in `tests/stubs/`.
 *
 * React components (`.tsx`) are deliberately not loadable: Node's type
 * stripping does not transform JSX, and tests cover the pure modules only.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TESTS_DIR);
const SRC = path.join(ROOT, "src");

const STUBS = new Map([
  ["server-only", "server-only.mjs"],
  ["next/headers", "next-headers.mjs"],
  ["next/navigation", "next-navigation.mjs"],
  ["next/cache", "next-cache.mjs"],
  ["next/server", "next-server.mjs"],
]);

const EXPLICIT_EXTENSION = /\.(?:[cm]?[jt]s|json)$/;

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The TypeScript/JavaScript file a bundler would pick for `base`, or null. */
function findModuleFile(base) {
  if (EXPLICIT_EXTENSION.test(base) && isFile(base)) return base;
  for (const candidate of [`${base}.ts`, `${base}.mts`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.mjs")]) {
    if (isFile(candidate)) return candidate;
  }
  for (const candidate of [`${base}.tsx`, path.join(base, "index.tsx")]) {
    if (isFile(candidate)) {
      throw new Error(`Tests cannot import React components (${path.relative(ROOT, candidate)}): move the logic you want to test into a .ts module.`);
    }
  }
  return null;
}

function notFound(specifier, parentURL) {
  const error = new Error(`Cannot find module "${specifier}" imported from ${parentURL ?? "the test runner"}`);
  error.code = "ERR_MODULE_NOT_FOUND";
  return error;
}

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) return { url: pathToFileURL(path.join(TESTS_DIR, "stubs", stub)).href, shortCircuit: true };

  if (specifier.startsWith("@/")) {
    const file = findModuleFile(path.join(SRC, specifier.slice(2)));
    if (!file) throw notFound(specifier, context.parentURL);
    return { url: pathToFileURL(file).href, shortCircuit: true };
  }

  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && context.parentURL?.startsWith("file:") && !EXPLICIT_EXTENSION.test(specifier)) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(ROOT) && !parent.includes(`${path.sep}node_modules${path.sep}`)) {
      const file = findModuleFile(path.resolve(path.dirname(parent), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
