import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { Role, User } from "@/lib/types";
import { sectionGateRedirect } from "@/lib/auth/section-gate";
import { canManageBatch } from "@/lib/data/batches";
import { canManageProgram } from "@/lib/data/programs";

/**
 * Real redirects instead of streamed ones.
 *
 * A `redirect()` or `notFound()` only changes the HTTP status when it runs
 * before the response starts streaming, i.e. outside every Suspense boundary
 * (`loading.tsx`). These tests keep the places that rely on that honest:
 *
 *  - every `gateSection([...])` layout is never stricter than a page below it
 *    (otherwise members the page allows would be locked out), and has no
 *    `loading.tsx` above it (otherwise the gate itself would stream);
 *  - the auth screens that redirect signed-in members, and the guest-only
 *    redirect of the certified-members directory, have no loading boundary
 *    above the code that redirects.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(APP_DIR);
const ROLE_LIST = /\[([^\]]*)\]/;

/** Roles in the first `call([...])` of `source`, or null when `call` is not used with a literal list. */
function rolesOf(source: string, call: "gateSection" | "requireRole"): Role[] | null {
  const at = source.search(new RegExp(`\\b${call}\\s*\\(\\s*\\[`));
  if (at < 0) return null;
  const list = ROLE_LIST.exec(source.slice(at));
  if (!list) return null;
  return [...list[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as Role);
}

/** `loading.tsx` files in `dir`'s ancestors, from `src/app` down to `dir`'s parent (or `dir` itself when `inclusive`). */
function loadingAbove(dir: string, inclusive: boolean): string[] {
  const found: string[] = [];
  let current = inclusive ? dir : path.dirname(dir);
  while (current.startsWith(APP_DIR)) {
    const loading = path.join(current, "loading.tsx");
    if (existsSync(loading)) found.push(path.relative(APP_DIR, loading));
    if (current === APP_DIR) break;
    current = path.dirname(current);
  }
  return found;
}

/**
 * Per-record permission helpers that some pages under a role gate use instead
 * of `requireRole`, with the roles they require at the very least (checked
 * below against the helpers themselves).
 */
const IMPLIED_ROLES: Record<string, Role[]> = {
  canManageBatch: ["moderator", "course_creator", "batch_evaluator"],
  canManageProgram: ["moderator", "course_creator"],
};

const gatedLayouts = files
  .filter((f) => path.basename(f) === "layout.tsx")
  .map((file) => ({ file, dir: path.dirname(file), roles: rolesOf(readFileSync(file, "utf8"), "gateSection") }))
  .filter((l): l is { file: string; dir: string; roles: Role[] } => l.roles !== null);

describe("sectionGateRedirect", () => {
  it("lets guests through (the proxy and the page handle them)", () => {
    assert.equal(sectionGateRedirect(null, ["admin"]), null);
  });

  it("sends members without any of the roles to /forbidden", () => {
    assert.equal(sectionGateRedirect({ roles: ["student"] }, ["moderator"]), "/forbidden");
    assert.equal(sectionGateRedirect({ roles: ["course_creator", "batch_evaluator"] }, ["admin"]), "/forbidden");
  });

  it("lets members with any one of the roles through", () => {
    assert.equal(sectionGateRedirect({ roles: ["batch_evaluator"] }, ["course_creator", "moderator", "batch_evaluator"]), null);
    assert.equal(sectionGateRedirect({ roles: ["student", "moderator"] }, ["moderator"]), null);
  });

  it("lets administrators through every gate", () => {
    assert.equal(sectionGateRedirect({ roles: ["admin"] }, ["moderator"]), null);
    assert.equal(sectionGateRedirect({ roles: ["admin"] }, ["course_creator", "batch_evaluator"]), null);
  });
});

describe("permission helpers used under role gates", () => {
  const member = (roles: Role[]) => ({ id: "usr_x", roles }) as unknown as User;

  it("canManageBatch never admits a member without a batch role, even one listed as its instructor", () => {
    const batch = { instructorIds: ["usr_x"], createdById: "usr_x" };
    assert.equal(canManageBatch(member(["student"]), batch), false);
    for (const role of IMPLIED_ROLES.canManageBatch!) assert.equal(canManageBatch(member([role]), batch), true, role);
  });

  it("canManageProgram never admits a member without a program role, even its creator", () => {
    const program = { createdById: "usr_x" };
    assert.equal(canManageProgram(member(["student"]), program), false);
    assert.equal(canManageProgram(member(["batch_evaluator"]), program), false);
    for (const role of IMPLIED_ROLES.canManageProgram!) assert.equal(canManageProgram(member([role]), program), true, role);
  });
});

describe("rolesOf", () => {
  it("reads the literal role list of the first call", () => {
    assert.deepEqual(rolesOf('await requireRole(["course_creator", "moderator"], `/admin/x/${id}`);', "requireRole"), ["course_creator", "moderator"]);
    assert.deepEqual(rolesOf('await gateSection(["admin"]);', "gateSection"), ["admin"]);
  });

  it("returns null when the call is missing", () => {
    assert.equal(rolesOf('await requireUser("/x");', "requireRole"), null);
  });
});

describe("section gate layouts", () => {
  it("exist (the admin sections and message moderation)", () => {
    assert.ok(gatedLayouts.length >= 20, `expected the section gates, found ${gatedLayouts.length}`);
  });

  for (const layout of gatedLayouts) {
    const name = path.relative(APP_DIR, layout.file).split(path.sep).join("/");

    it(`${name}: no page below it is reachable with fewer roles`, () => {
      const pages = files.filter((f) => path.basename(f) === "page.tsx" && f.startsWith(layout.dir + path.sep));
      assert.ok(pages.length > 0, "a gate without pages");
      for (const page of pages) {
        const source = readFileSync(page, "utf8");
        const helper = Object.keys(IMPLIED_ROLES).find((name) => new RegExp(`if \\(!${name}\\(user, \\w+\\)\\) redirect\\("/forbidden"\\)`).test(source));
        const roles = rolesOf(source, "requireRole") ?? (helper ? IMPLIED_ROLES[helper]! : null);
        const pageName = path.relative(APP_DIR, page).split(path.sep).join("/");
        assert.ok(roles, `${pageName} does not call requireRole([...]) or a known permission helper, so the gate may turn away members it serves`);
        // Admins pass every gate, so only the other roles a page admits must pass the layout too.
        const extra = roles.filter((role) => role !== "admin" && !layout.roles.includes(role));
        assert.ok(extra.length === 0, `${pageName} admits ${extra.join(", ")}, which the layout gate (${layout.roles.join(", ")}) turns away`);
      }
    });

    it(`${name}: no loading screen above it`, () => {
      assert.deepEqual(loadingAbove(layout.dir, false), [], "a loading.tsx above the gate makes its redirect stream");
    });
  }
});

const PREDICATE_GATE = /\bgateSectionWith\(\s*([A-Za-z_$][\w$]*)\s*,\s*"([^"]+)"\s*\)/;
const predicateLayouts = files
  .filter((f) => path.basename(f) === "layout.tsx")
  .map((file) => ({ file, dir: path.dirname(file), match: PREDICATE_GATE.exec(readFileSync(file, "utf8")) }))
  .filter((l): l is { file: string; dir: string; match: RegExpExecArray } => l.match !== null);

describe("permission-helper gate layouts", () => {
  it("exist (assignments, rubrics and certificates)", () => {
    assert.ok(predicateLayouts.length >= 3, `expected the permission gates, found ${predicateLayouts.length}`);
  });

  for (const layout of predicateLayouts) {
    const name = path.relative(APP_DIR, layout.file).split(path.sep).join("/");
    const [, helper, target] = layout.match;

    it(`${name}: every page below it makes the same check with the same redirect`, () => {
      const pages = files.filter((f) => path.basename(f) === "page.tsx" && f.startsWith(layout.dir + path.sep));
      assert.ok(pages.length > 0, "a gate without pages");
      const sameCheck = new RegExp(`if \\(!${helper}\\(user\\)\\) redirect\\("${target!.replace(/[/]/g, "\\/")}"\\)`);
      for (const page of pages) {
        const pageName = path.relative(APP_DIR, page).split(path.sep).join("/");
        assert.match(readFileSync(page, "utf8"), sameCheck, `${pageName} does not check ${helper} and redirect to ${target}`);
      }
    });

    it(`${name}: no loading screen above it`, () => {
      assert.deepEqual(loadingAbove(layout.dir, false), [], "a loading.tsx above the gate makes its redirect stream");
    });
  }
});

describe("redirects that must happen before streaming", () => {
  for (const page of ["(auth)/login", "(auth)/register", "(auth)/two-factor"]) {
    it(`${page} redirects signed-in members with a real 307`, () => {
      const dir = path.join(APP_DIR, ...page.split("/"));
      assert.ok(existsSync(path.join(dir, "page.tsx")), `${page}/page.tsx is missing`);
      assert.deepEqual(loadingAbove(dir, true), []);
    });
  }

  it("the certified-members directory checks guests in its layout, outside the loading screen", () => {
    const dir = path.join(APP_DIR, "(app)", "certified-members");
    const layout = readFileSync(path.join(dir, "layout.tsx"), "utf8");
    assert.match(layout, /getCurrentUser\(\)/);
    assert.match(layout, /redirect\("\/courses"\)/);
    assert.deepEqual(loadingAbove(dir, false), []);
  });

  it("the account-recovery screens keep their loading screen", () => {
    for (const page of ["forgot-password", "reset-password", "verify-email"]) {
      assert.ok(existsSync(path.join(APP_DIR, "(auth)", page, "loading.tsx")), `(auth)/${page}/loading.tsx is missing`);
    }
  });
});
