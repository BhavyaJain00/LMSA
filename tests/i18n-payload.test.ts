import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { LOCALES, NAMESPACES } from "@/i18n/config";
import { catalogMessages, englishMessages, pickMessages } from "@/i18n/catalog";
import { ROUTE_PROVIDED_GLOBALS, globalSlices } from "@/i18n/provided";
import { ADMIN_SECTIONS, adminClientPrefixes, adminClientSlices, type AdminSection } from "@/components/admin/i18n-slices";

/*
 * What the browser receives: the root layout's slice must stay small (no
 * player strings on pages without a player), each /admin route must get only
 * the slices its client components read, and every client component must
 * still find its keys in the providers above it.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app");

const rootPick = globalSlices(["common", "shell"], (namespace) => Object.keys(englishMessages(namespace)));

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function rootPayload(locale: (typeof LOCALES)[number]) {
  let keys = 0;
  let size = 0;
  for (const namespace of NAMESPACES) {
    const messages = pickMessages(catalogMessages(locale, namespace), rootPick[namespace]);
    keys += Object.keys(messages).length;
    size += bytes(messages);
  }
  return { keys, size };
}

/* ---------- a small static import graph over src/ ---------- */

const sourceCache = new Map<string, string>();
function source(file: string): string {
  let text = sourceCache.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    sourceCache.set(file, text);
  }
  return text;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const importsCache = new Map<string, string[]>();
/** The local modules a file imports directly (type-only imports left out). */
function imports(file: string): string[] {
  let list = importsCache.get(file);
  if (!list) {
    list = [];
    for (const match of source(file).matchAll(IMPORT_RE)) {
      if (/^import\s+type\s/.test(match[0])) continue;
      const resolved = resolveImport(file, match[1] ?? match[2]!);
      if (resolved && /\.tsx?$/.test(resolved)) list.push(resolved);
    }
    importsCache.set(file, list);
  }
  return list;
}

const closureCache = new Map<string, Set<string>>();
/** Every local module a file pulls in, itself included. */
function closure(entry: string): Set<string> {
  const cached = closureCache.get(entry);
  if (cached) return cached;
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...imports(file));
  }
  closureCache.set(entry, seen);
  return seen;
}

const ROUTE_FILES = new Set(["page.tsx", "layout.tsx", "error.tsx", "loading.tsx", "not-found.tsx", "template.tsx"]);
function routeEntries(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routeEntries(full, out);
    else if (ROUTE_FILES.has(name)) out.push(full);
  }
  return out;
}

/** The layout files above (and beside) a route file, root first. */
function layoutChain(entry: string): string[] {
  const chain: string[] = [];
  let dir = path.dirname(entry);
  for (;;) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout)) chain.unshift(layout);
    if (dir === APP) break;
    dir = path.dirname(dir);
  }
  return chain;
}

const CLIENT_ADMIN_PREFIXES = adminClientPrefixes().map((prefix) => prefix.slice(0, -1));
const ADMIN_KEY_RE = new RegExp(`["'\`](${CLIENT_ADMIN_PREFIXES.join("|")})\\.[A-Za-z$]`, "g");

/** Admin client prefixes a module reads with `useT("admin")`. */
function adminPrefixesRead(file: string): string[] {
  const text = source(file);
  if (!text.includes('useT("admin")')) return [];
  return [...new Set([...text.matchAll(ADMIN_KEY_RE)].map((m) => `${m[1]}.`))];
}

/** Admin prefixes the layouts above a route provide. */
function adminPrefixesProvided(entry: string): Set<string> {
  const provided = new Set<string>();
  for (const layout of layoutChain(entry)) {
    for (const match of source(layout).matchAll(/<AdminI18n\s+section="(\w+)"/g)) {
      assert.ok((ADMIN_SECTIONS as string[]).includes(match[1]!), `${path.relative(ROOT, layout)}: unknown admin section "${match[1]}"`);
      for (const prefix of adminClientSlices(match[1] as AdminSection)) provided.add(prefix);
    }
  }
  return provided;
}

/* ---------- tests ---------- */

describe("i18n payload: root layout", () => {
  it("leaves the player's messages to the pages that render a player", () => {
    const learningPick = rootPick.learning ?? [];
    assert.ok(learningPick.length > 0);
    assert.ok(!learningPick.some((prefix) => prefix === "global." || "global.player.x".startsWith(prefix)), `root learning pick: ${learningPick.join(", ")}`);
    const learning = pickMessages(catalogMessages("en", "learning"), learningPick);
    assert.equal(Object.keys(learning).filter((key) => key.startsWith("global.player.")).length, 0);
    assert.ok(Object.keys(learning).some((key) => key.startsWith("global.markdown.")), "other learning globals are still provided");
    assert.deepEqual(ROUTE_PROVIDED_GLOBALS.learning, ["global.player."]);
  });

  it("stays small in every language", () => {
    for (const locale of LOCALES) {
      const { keys, size } = rootPayload(locale);
      assert.ok(keys < 560, `${locale}: ${keys} keys`);
      assert.ok(size < 40_000, `${locale}: ${size} bytes`);
    }
  });

  it("every component reading player messages is under a player provider", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const entry of routeEntries(APP)) {
      const readers = [...closure(entry)].filter((file) => source(file).includes('useT("learning")') && source(file).includes('"global.player.'));
      if (!readers.length) continue;
      checked++;
      const provided = layoutChain(entry).some((layout) => /PlayerI18n|"global\.player\."/.test(source(layout)));
      if (!provided) missing.push(`${path.relative(ROOT, entry)} <- ${readers.map((f) => path.relative(ROOT, f)).join(", ")}`);
    }
    assert.ok(checked >= 4, `only ${checked} routes render the player: the scan is broken`);
    assert.deepEqual(missing, []);
  });
});

describe("i18n payload: admin sections", () => {
  it("every client area of the admin namespace belongs to a section, and no section sends server-only or root keys", () => {
    const claimed = new Set(ADMIN_SECTIONS.flatMap((section) => adminClientSlices(section)));
    assert.deepEqual(adminClientPrefixes().filter((prefix) => !claimed.has(prefix)), []);
    const known = new Set(adminClientPrefixes());
    for (const section of ADMIN_SECTIONS) {
      for (const prefix of adminClientSlices(section)) {
        assert.ok(known.has(prefix), `${section}: "${prefix}" matches no admin key`);
        assert.ok(!prefix.startsWith("pages.") && !prefix.startsWith("global."), `${section}: ${prefix}`);
      }
    }
  });

  it("no admin route sends more than a fraction of the admin namespace", () => {
    const clientKeys = Object.keys(englishMessages("admin")).filter((key) => !key.startsWith("pages.") && !key.startsWith("global.")).length;
    for (const entry of routeEntries(APP)) {
      const provided = [...adminPrefixesProvided(entry)];
      if (!provided.length) continue;
      for (const locale of LOCALES) {
        const messages = pickMessages(catalogMessages(locale, "admin"), provided);
        const keys = Object.keys(messages).length;
        assert.ok(keys <= clientKeys / 3, `${path.relative(ROOT, entry)} (${locale}): ${keys} of ${clientKeys} keys`);
        assert.ok(bytes(messages) < 32_000, `${path.relative(ROOT, entry)} (${locale}): ${bytes(messages)} bytes`);
      }
    }
  });

  it("the admin shell sends only shared slices and a settings page only its own form", () => {
    const base = pickMessages(catalogMessages("en", "admin"), adminClientSlices("base"));
    assert.ok(Object.keys(base).length < 120, `${Object.keys(base).length} keys`);
    assert.ok(!Object.keys(base).some((key) => key.startsWith("members.") || key.startsWith("seoForm.")));
    const settings = adminClientSlices("settings");
    assert.deepEqual([...settings], ["settingsNav."]);
    assert.ok(!adminClientSlices("settingsAi").includes("seoForm."));
  });

  it("every client component reading admin messages finds them in its route's providers", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const entry of routeEntries(APP)) {
      const provided = adminPrefixesProvided(entry);
      for (const file of closure(entry)) {
        const read = adminPrefixesRead(file);
        if (!read.length) continue;
        checked++;
        const absent = read.filter((prefix) => !provided.has(prefix));
        if (absent.length) missing.push(`${path.relative(ROOT, entry)} <- ${path.relative(ROOT, file)}: ${absent.join(", ")}`);
      }
    }
    assert.ok(checked > 20, `only ${checked} admin client modules found: the scan is broken`);
    assert.deepEqual(missing, []);
  });
});
