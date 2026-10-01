import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { guestLoginPath, isLoginOnlyPage, LOGIN_ONLY_PAGES, STATIC_ROUTE_HANDLERS } from "@/lib/auth/login-only-pages";
import { proxy } from "@/proxy";

const APP_DIR = path.join(process.cwd(), "src", "app");
const GUARD = /\b(requireUser|requireRole|requireManageableCourse)\s*\(/;

/** Pages that call a guard only in some branches and also serve guests. */
const SERVES_GUESTS = new Set(["/team/buy"]);

interface RouteFile {
  /** URL pattern, route groups removed (`/admin/courses/[id]`). */
  pattern: string;
  file: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function toPattern(file: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

const files = walk(APP_DIR);
const pages: RouteFile[] = files.filter((f) => path.basename(f) === "page.tsx").map((file) => ({ file, pattern: toPattern(file) }));
const routes: RouteFile[] = files.filter((f) => /^route\.(ts|tsx)$/.test(path.basename(f))).map((file) => ({ file, pattern: toPattern(file) }));

/** A concrete URL for a pattern (`[id]` → `sample-id`, catch-alls → two segments). */
function sample(pattern: string): string {
  return pattern
    .split("/")
    .map((s) => (s.startsWith("[[...") || s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "sample-id" : s))
    .join("/");
}

/** Layouts that guard every page below them. */
function guardedByLayout(pageFile: string): boolean {
  let dir = path.dirname(pageFile);
  while (dir.startsWith(APP_DIR)) {
    const layout = path.join(dir, "layout.tsx");
    if (files.includes(layout) && GUARD.test(readFileSync(layout, "utf8"))) return true;
    dir = path.dirname(dir);
  }
  return false;
}

function fakeRequest(url: string, opts: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const u = new URL(url);
  const cookies = opts.cookies ?? {};
  const headers = new Headers({ host: u.host, ...opts.headers });
  return {
    method: opts.method ?? "GET",
    url: u.toString(),
    nextUrl: u,
    headers,
    cookies: {
      has: (name: string) => name in cookies,
      get: (name: string) => (name in cookies ? { name, value: cookies[name]! } : undefined),
    },
  } as unknown as Parameters<typeof proxy>[0];
}

describe("login-only page matcher", () => {
  it("matches static and dynamic login-only pages exactly", () => {
    for (const p of ["/dashboard", "/admin", "/admin/settings/data", "/settings", "/billing/history", "/messages", "/messages/cnv_1", "/user/maya/edit", "/quiz/q1", "/admin/courses/crs_1/lessons/l1/transcript", "/dashboard/"]) {
      assert.equal(isLoginOnlyPage(p), true, p);
    }
  });

  it("leaves public pages, deeper paths and route handlers alone", () => {
    for (const p of [
      "/",
      "/courses",
      "/courses/intro",
      "/courses/intro/learn/1-1",
      "/user/maya",
      "/you",
      "/team/buy",
      "/leaderboard",
      "/quiz/q1/submit",
      "/messages/feed",
      "/admin/settings/plans/export",
      "/settings/privacy/export",
      "/dashboardx",
      "/admin-tools",
      "/user//edit",
      "dashboard",
    ]) {
      assert.equal(isLoginOnlyPage(p), false, p);
    }
  });

  it("covers every page that always requires a login", () => {
    const missing = pages
      .filter((p) => !SERVES_GUESTS.has(p.pattern))
      .filter((p) => GUARD.test(readFileSync(p.file, "utf8")) || guardedByLayout(p.file))
      .filter((p) => !isLoginOnlyPage(sample(p.pattern)))
      .map((p) => p.pattern);
    assert.deepEqual(missing, [], "add these pages to LOGIN_ONLY_PAGES");
  });

  it("lists only pages that exist", () => {
    const known = new Set(pages.map((p) => p.pattern));
    assert.deepEqual(LOGIN_ONLY_PAGES.filter((p) => !known.has(p)), []);
    assert.equal(new Set(LOGIN_ONLY_PAGES).size, LOGIN_ONLY_PAGES.length, "no duplicates");
  });

  it("never catches a route handler", () => {
    const caught = routes.filter((r) => isLoginOnlyPage(sample(r.pattern))).map((r) => r.pattern);
    assert.deepEqual(caught, [], "add static handlers shadowed by a [param] page to STATIC_ROUTE_HANDLERS");
    const handlers = new Set(routes.map((r) => r.pattern));
    assert.deepEqual(STATIC_ROUTE_HANDLERS.filter((p) => !handlers.has(p)), [], "only existing route handlers are listed");
  });

  it("builds a safe login path that returns to the page", () => {
    assert.equal(guestLoginPath("/billing/history", ""), "/login?next=%2Fbilling%2Fhistory");
    assert.equal(guestLoginPath("/quiz/q1", "?lesson=l1&course=c1"), `/login?next=${encodeURIComponent("/quiz/q1?lesson=l1&course=c1")}`);
    assert.equal(guestLoginPath("//evil.example/x", ""), "/login");
    assert.equal(guestLoginPath("/\\evil.example", ""), "/login");
  });
});

describe("proxy guest redirect", () => {
  it("sends guests on a login-only page a real 307 to the login page", () => {
    const res = proxy(fakeRequest("http://localhost:3000/settings/security?tab=2fa"));
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/settings/security?tab=2fa");
  });

  it("lets signed-in visitors, public pages and non-GET requests through", () => {
    const session = { ll_session: "abc" };
    for (const res of [
      proxy(fakeRequest("http://localhost:3000/dashboard", { cookies: session })),
      proxy(fakeRequest("http://localhost:3000/courses")),
      proxy(fakeRequest("http://localhost:3000/dashboard", { method: "POST" })),
      proxy(fakeRequest("http://localhost:3000/quiz/q1/submit", { method: "POST" })),
    ]) {
      assert.equal(res.headers.get("location"), null);
      assert.equal(res.headers.get("x-middleware-next"), "1");
    }
  });

  it("keeps signed one-click unsubscribe links working without a session", () => {
    const res = proxy(fakeRequest("http://localhost:3000/settings/notifications?unsubscribe=course&u=usr_1&t=sig"));
    assert.equal(res.headers.get("location"), null);
    const plain = proxy(fakeRequest("http://localhost:3000/settings/notifications"));
    assert.equal(plain.status, 307);
  });

  it("keeps the referral cookie on the login redirect", () => {
    const res = proxy(fakeRequest("http://localhost:3000/dashboard?ref=FRIEND10"));
    assert.equal(res.status, 307);
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("ll_ref=")), "the ?ref click survives the redirect");
  });
});
