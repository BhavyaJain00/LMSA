import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { BlogPost, Database, SlugRedirect } from "@/lib/types";
import { defaultSettings } from "@/lib/db/defaults";
import { buildContentIndex, fingerprint } from "@/lib/seo/content-index";
import { rowsFromRules, rulesFromRows } from "@/lib/seo/content-sync";
import { REDIRECTS_FILE, parseRedirectRules, readRedirectRulesSync, seoFilePath, writeRedirectRules } from "@/lib/seo/files";
import { canonicalHostMode, canonicalOriginFor, isInternalHost, normalizeHost, seoRedirectTarget, stripTrailingSlash } from "@/lib/seo/proxy-canonical";
import { isRedirectCandidate, slugRedirectFor } from "@/lib/seo/proxy-redirects";
import {
  type ContentIndex,
  REDIRECT_PATH_MAX,
  addRedirect,
  buildRedirectIndex,
  diffContentIndex,
  pruneShadowedRedirects,
  redirectKey,
  redirectTargetStatus,
  resolveRedirect,
  validateManualRedirect,
} from "@/lib/seo/redirects";
import { SLUG_MAX, isValidSlug, suggestSlug, tagLabel, tagSlug } from "@/lib/seo/text";
import { makeBatch, makeCourse } from "./helpers/db";

/** Slug changes → permanent redirects, the proxy's canonical-address decisions and slug suggestions. */

const ORIGIN = "https://example.com";

describe("redirectKey", () => {
  it("normalises paths for matching", () => {
    assert.equal(redirectKey("/Courses/Old/"), "/courses/old");
    assert.equal(redirectKey("courses/x?y=1#z"), "/courses/x");
    assert.equal(redirectKey("/"), "/");
    assert.equal(redirectKey("/caf%C3%A9"), "/café");
    // A malformed encoding is kept as typed instead of throwing.
    assert.equal(redirectKey("/bad%E0%A4%A"), "/bad%e0%a4%a");
  });
});

describe("addRedirect", () => {
  const rule = (from: string, to: string) => ({ from, to });

  it("adds a rule", () => {
    assert.deepEqual(addRedirect([], "/courses/a", "/courses/b"), [rule("/courses/a", "/courses/b")]);
  });

  it("collapses chains so every old address reaches the newest one in a single hop", () => {
    const rules = addRedirect(addRedirect([], "/courses/a", "/courses/b"), "/courses/b", "/courses/c");
    assert.deepEqual(rules, [rule("/courses/a", "/courses/c"), rule("/courses/b", "/courses/c")]);
  });

  it("stops redirecting away from a slug that is used again", () => {
    // a → b, then the course is renamed back to a: b now leads to a, and a is live again.
    assert.deepEqual(addRedirect([rule("/courses/a", "/courses/b")], "/courses/b", "/courses/a"), [rule("/courses/b", "/courses/a")]);
  });

  it("replaces an existing rule for the same old address", () => {
    assert.deepEqual(addRedirect([rule("/courses/a", "/courses/b")], "/courses/a", "/courses/c"), [rule("/courses/a", "/courses/c")]);
  });

  it("ignores rules that go nowhere or move the home page", () => {
    const rules = [rule("/courses/a", "/courses/b")];
    assert.deepEqual(addRedirect(rules, "/courses/x", "/courses/x/"), rules);
    assert.deepEqual(addRedirect(rules, "/", "/courses"), rules);
    assert.notEqual(addRedirect(rules, "/", "/courses"), rules);
  });

  it("drops rules shadowed by a live page", () => {
    const rules = [rule("/courses/a", "/courses/b"), rule("/courses/x", "/courses/y")];
    assert.deepEqual(pruneShadowedRedirects(rules, ["/courses/A", "/courses/b"]), [rule("/courses/x", "/courses/y")]);
  });
});

describe("resolveRedirect", () => {
  const index = buildRedirectIndex([
    { from: "/courses/old", to: "/courses/new" },
    { from: "/promo", to: "/courses" },
    { from: "/", to: "/nowhere" },
  ]);

  it("matches exactly, ignoring case and a trailing slash", () => {
    assert.equal(resolveRedirect(index, "/courses/old"), "/courses/new");
    assert.equal(resolveRedirect(index, "/Courses/OLD/"), "/courses/new");
  });

  it("moves sub-pages with their parent and keeps the rest of the path as typed", () => {
    assert.equal(resolveRedirect(index, "/courses/old/learn/1-2"), "/courses/new/learn/1-2");
    assert.equal(resolveRedirect(index, "/courses/old/opengraph-image"), "/courses/new/opengraph-image");
    assert.equal(resolveRedirect(index, "/courses/old/Learn/ABC"), "/courses/new/Learn/ABC");
  });

  it("never lets a one-segment rule swallow a whole section", () => {
    assert.equal(resolveRedirect(index, "/promo"), "/courses");
    assert.equal(resolveRedirect(index, "/promo/anything"), null);
  });

  it("returns null for unknown paths, the home page and an empty rule set", () => {
    assert.equal(resolveRedirect(index, "/courses/other"), null);
    assert.equal(resolveRedirect(index, "/courses/older"), null);
    assert.equal(resolveRedirect(index, "/"), null);
    assert.equal(resolveRedirect(new Map(), "/courses/old"), null);
  });

  it("follows a few hops and refuses loops", () => {
    const chain = buildRedirectIndex([
      { from: "/courses/a", to: "/courses/b" },
      { from: "/courses/b", to: "/courses/c" },
    ]);
    assert.equal(resolveRedirect(chain, "/courses/a"), "/courses/c");
    const loop = buildRedirectIndex([
      { from: "/courses/a", to: "/courses/b" },
      { from: "/courses/b", to: "/courses/a" },
    ]);
    assert.equal(resolveRedirect(loop, "/courses/a"), null);
  });
});

describe("diffContentIndex", () => {
  const entry = (path: string, isPublic = true, stamp = "1") => ({ path, public: isPublic, stamp });

  it("detects a changed slug and asks engines to recrawl both addresses", () => {
    const diff = diffContentIndex({ "course:1": entry("/courses/a") }, { "course:1": entry("/courses/b") });
    assert.deepEqual(diff.moved, [{ from: "/courses/a", to: "/courses/b" }]);
    assert.deepEqual(diff.changed.sort(), ["/courses/a", "/courses/b"]);
  });

  it("records the redirect of a renamed draft without pinging anyone", () => {
    const diff = diffContentIndex({ "course:1": entry("/courses/a", false) }, { "course:1": entry("/courses/b", false) });
    assert.deepEqual(diff.moved, [{ from: "/courses/a", to: "/courses/b" }]);
    assert.deepEqual(diff.changed, []);
  });

  it("reports newly published, updated, unpublished and deleted public pages", () => {
    const prev: ContentIndex = {
      "course:same": entry("/courses/same"),
      "course:updated": entry("/courses/updated", true, "1"),
      "course:published": entry("/courses/published", false),
      "course:unpublished": entry("/courses/unpublished", true),
      "course:deleted": entry("/courses/deleted", true),
      "course:deleted-draft": entry("/courses/deleted-draft", false),
    };
    const next: ContentIndex = {
      "course:same": entry("/courses/same"),
      "course:updated": entry("/courses/updated", true, "2"),
      "course:published": entry("/courses/published", true),
      "course:unpublished": entry("/courses/unpublished", false),
      "course:new": entry("/courses/new", true),
      "course:new-draft": entry("/courses/new-draft", false),
    };
    const diff = diffContentIndex(prev, next);
    assert.deepEqual(diff.moved, []);
    assert.deepEqual(diff.changed.sort(), ["/courses/deleted", "/courses/new", "/courses/published", "/courses/unpublished", "/courses/updated"]);
  });
});

describe("buildContentIndex", () => {
  type IndexDb = Pick<Database, "courses" | "batches" | "programs" | "jobs" | "blogPosts" | "categories" | "settings">;
  const NOW = Date.parse("2026-06-01T00:00:00.000Z");
  const blogPost = (id: string, overrides: Partial<BlogPost> = {}): BlogPost => ({
    id,
    slug: id,
    title: id,
    excerpt: "",
    content: "",
    authorId: "usr_a",
    categoryIds: [],
    tags: [],
    status: "published",
    publishedAt: "2026-05-01T00:00:00.000Z",
    relatedCourseIds: [],
    readingTimeSeconds: 60,
    views: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });
  const db = (): IndexDb => ({
    settings: defaultSettings(),
    courses: [makeCourse({ id: "crs_pub", slug: "live" }), makeCourse({ id: "crs_draft", slug: "draft", published: false }), makeCourse({ id: "crs_later", slug: "later", publishAt: "2026-09-01T00:00:00.000Z" })],
    batches: [makeBatch({ id: "bat_pub", slug: "cohort" }), makeBatch({ id: "bat_private", slug: "private", published: false })],
    programs: [],
    jobs: [],
    blogPosts: [blogPost("post-live"), blogPost("post-noindex", { noindex: true }), blogPost("post-draft", { status: "draft" })],
    categories: [{ id: "cat_1", name: "Design", slug: "design" }],
  });

  it("maps every item to its path and whether anonymous visitors can open it", () => {
    const index = buildContentIndex(db(), NOW);
    assert.deepEqual(index["course:crs_pub"], { path: "/courses/live", public: true, stamp: "2026-01-15T12:00:00.000Z|" });
    assert.equal(index["course:crs_draft"]!.public, false);
    assert.equal(index["course:crs_later"]!.public, false);
    assert.equal(index["batch:bat_pub"]!.public, true);
    assert.equal(index["batch:bat_private"]!.public, false);
    assert.equal(index["post:post-live"]!.path, "/blog/post-live");
    assert.equal(index["post:post-live"]!.public, true);
    assert.equal(index["post:post-noindex"]!.public, false);
    assert.equal(index["post:post-draft"]!.public, false);
    assert.equal(index["category:cat_1"]!.path, "/courses/category/design");
  });

  it("treats nothing in the catalog as public when guests must sign in", () => {
    const data = db();
    data.settings.learning.allowGuestAccess = false;
    const index = buildContentIndex(data, NOW);
    assert.equal(index["course:crs_pub"]!.public, false);
    assert.equal(index["batch:bat_pub"]!.public, false);
    assert.equal(index["category:cat_1"]!.public, false);
    assert.equal(index["post:post-live"]!.public, true);
  });

  it("notices edits to a category's landing text", () => {
    const before = buildContentIndex(db(), NOW)["category:cat_1"]!.stamp;
    const data = db();
    data.categories[0]!.intro = "Learn design from scratch.";
    assert.notEqual(buildContentIndex(data, NOW)["category:cat_1"]!.stamp, before);
    assert.equal(fingerprint("a|b"), fingerprint("a|b"));
    assert.match(fingerprint("anything"), /^[0-9a-f]{1,8}$/);
  });

  it("turns a renamed course into a redirect end to end", () => {
    const before = buildContentIndex(db(), NOW);
    const data = db();
    data.courses[0]!.slug = "live-renamed";
    const diff = diffContentIndex(before, buildContentIndex(data, NOW));
    const rules = diff.moved.reduce((acc, move) => addRedirect(acc, move.from, move.to), [] as { from: string; to: string }[]);
    assert.equal(resolveRedirect(buildRedirectIndex(rules), "/courses/live/learn/1-1"), "/courses/live-renamed/learn/1-1");
  });
});

describe("validateManualRedirect", () => {
  const check = (from: string, to: string, livePaths: string[] = []) => validateManualRedirect(from, to, { origin: ORIGIN, livePaths });

  it("accepts paths and full addresses of this site", () => {
    assert.deepEqual(check("/old-page", "/courses/new"), { ok: true, from: "/old-page", to: "/courses/new" });
    assert.deepEqual(check(`${ORIGIN}/Old/Page/?x=1`, `${ORIGIN}/blog/new-post#top`), { ok: true, from: "/old/page", to: "/blog/new-post" });
  });

  it("requires both addresses", () => {
    const result = check("", " ");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.fromPath && result.errors.toPath);
  });

  it("refuses other sites and protocol-relative addresses", () => {
    for (const bad of ["https://evil.example.org/x", "//evil.example.org/x", "javascript:alert(1)", "courses/x"]) {
      const from = check(bad, "/courses/new");
      assert.ok(!from.ok && from.errors.fromPath, `from ${bad}`);
      const to = check("/old-page", bad);
      assert.ok(!to.ok && to.errors.toPath, `to ${bad}`);
    }
  });

  it("refuses the home page, private areas, section indexes and live pages", () => {
    for (const from of ["/", "/admin/courses", "/api/upload", "/login", "/uploads/a.png", "/courses", "/blog/", "/sitemap.xml"]) {
      const result = check(from, "/courses/new");
      assert.ok(!result.ok && result.errors.fromPath, from);
    }
    const live = check("/courses/Live", "/courses/new", ["/courses/live"]);
    assert.ok(!live.ok && /lives at this address/.test(live.errors.fromPath ?? ""));
  });

  it("refuses redirects that loop", () => {
    const same = check("/courses/a", "/courses/A/");
    assert.ok(!same.ok && same.errors.toPath);
    const inside = check("/courses/a", "/courses/a/learn");
    assert.ok(!inside.ok && /forever/.test(inside.errors.toPath ?? ""));
  });

  it("limits the length of both addresses", () => {
    const long = `/${"a".repeat(REDIRECT_PATH_MAX)}`;
    const from = check(long, "/courses/new");
    assert.ok(!from.ok && from.errors.fromPath);
    const to = check("/old-page", long);
    assert.ok(!to.ok && to.errors.toPath);
  });
});

describe("redirectTargetStatus", () => {
  const index: ContentIndex = {
    "course:1": { path: "/courses/live", public: true, stamp: "1" },
    "course:2": { path: "/courses/draft", public: false, stamp: "1" },
    "category:1": { path: "/courses/category/design", public: true, stamp: "1" },
  };

  it("tells live, hidden and deleted destinations apart", () => {
    assert.equal(redirectTargetStatus("/courses/live", index), "live");
    assert.equal(redirectTargetStatus("/Courses/Live/", index), "live");
    assert.equal(redirectTargetStatus("/courses/draft", index), "hidden");
    assert.equal(redirectTargetStatus("/courses/gone", index), "missing");
    assert.equal(redirectTargetStatus("/blog/gone", index), "missing");
    assert.equal(redirectTargetStatus("/courses/category/gone", index), "missing");
  });

  it("does not flag ordinary pages", () => {
    for (const page of ["/courses", "/pricing", "/courses/category", "/courses/tag", "/courses/tag/figma", "/instructors/ada", "/courses/live/learn/1-1"]) {
      assert.equal(redirectTargetStatus(page, index), "page", page);
    }
  });
});

describe("stored redirect rows", () => {
  const rows: SlugRedirect[] = [
    { id: "redir_1", fromPath: "/courses/a", toPath: "/courses/b", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "redir_2", fromPath: "/courses/x", toPath: "/courses/y", createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  it("keeps ids and dates of unchanged rules and only stamps new ones", () => {
    const rules = addRedirect(rulesFromRows(rows), "/courses/b", "/courses/c");
    const next = rowsFromRules(rules, rows, "2026-02-01T00:00:00.000Z");
    assert.equal(next.length, 3);
    // Unchanged row: the very same object.
    assert.equal(next.find((r) => r.fromPath === "/courses/x"), rows[1]);
    // Retargeted row keeps its identity.
    assert.deepEqual(next.find((r) => r.fromPath === "/courses/a"), { id: "redir_1", fromPath: "/courses/a", toPath: "/courses/c", createdAt: "2026-01-01T00:00:00.000Z" });
    const added = next.find((r) => r.fromPath === "/courses/b")!;
    assert.equal(added.toPath, "/courses/c");
    assert.equal(added.createdAt, "2026-02-01T00:00:00.000Z");
    assert.ok(added.id && added.id !== "redir_1" && added.id !== "redir_2");
  });
});

describe("redirect file read by the proxy", () => {
  it("ignores malformed and unsafe rules", () => {
    assert.deepEqual(parseRedirectRules("nope"), []);
    assert.deepEqual(parseRedirectRules(null), []);
    assert.deepEqual(
      parseRedirectRules([
        { from: "/courses/a", to: "/courses/b", extra: true },
        { from: "/courses/c", to: "//evil.example.org" },
        { from: "/courses/d", to: "https://evil.example.org" },
        { from: "courses/e", to: "/courses/f" },
        { from: 1, to: "/x" },
        null,
        "text",
      ]),
      [{ from: "/courses/a", to: "/courses/b" }],
    );
  });

  it("only looks up paths that can belong to a page", () => {
    assert.equal(isRedirectCandidate("/courses/old"), true);
    assert.equal(isRedirectCandidate("/"), false);
    assert.equal(isRedirectCandidate("/_next/static/chunk.js"), false);
    assert.equal(isRedirectCandidate("/api/upload"), false);
  });

  it("serves rules from memory and re-reads the file at most once a second", async () => {
    await writeRedirectRules([{ from: "/courses/old", to: "/courses/new" }]);
    assert.deepEqual(readRedirectRulesSync()?.rules, [{ from: "/courses/old", to: "/courses/new" }]);
    const t0 = Date.now();
    assert.equal(slugRedirectFor("/courses/old/learn/1-1", t0), "/courses/new/learn/1-1");
    assert.equal(slugRedirectFor("/courses/unrelated", t0), null);

    await writeRedirectRules([{ from: "/courses/old", to: "/courses/newest" }]);
    // Make sure the new file has a different modification time, whatever the clock resolution.
    const later = new Date(t0 + 60_000);
    fs.utimesSync(seoFilePath(REDIRECTS_FILE), later, later);
    assert.equal(slugRedirectFor("/courses/old", t0 + 500), "/courses/new");
    assert.equal(slugRedirectFor("/courses/old", t0 + 1500), "/courses/newest");

    await writeRedirectRules([]);
    const evenLater = new Date(t0 + 120_000);
    fs.utimesSync(seoFilePath(REDIRECTS_FILE), evenLater, evenLater);
    assert.equal(slugRedirectFor("/courses/old", t0 + 3000), null);
  });
});

describe("canonical host and trailing slash", () => {
  it("reads the host mode from SEO_CANONICAL_HOST", () => {
    assert.equal(canonicalHostMode(undefined), "www");
    assert.equal(canonicalHostMode(""), "www");
    assert.equal(canonicalHostMode(" ALL "), "all");
    assert.equal(canonicalHostMode("off"), "off");
    assert.equal(canonicalHostMode("sometimes"), "www");
  });

  it("normalises Host headers", () => {
    assert.equal(normalizeHost("Example.COM:443"), "example.com");
    assert.equal(normalizeHost("example.com:80"), "example.com");
    assert.equal(normalizeHost("example.com:8080"), "example.com:8080");
    assert.equal(normalizeHost("a.example.com, b.example.com"), "a.example.com");
    assert.equal(normalizeHost(null), "");
  });

  it("recognises hosts that only exist inside a machine or network", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:3000", "10.0.0.5", "[::1]:3000", "app", "web:3000", "lms.internal", "dev.local", ""]) assert.ok(isInternalHost(host), host);
    for (const host of ["example.com", "www.example.com", "learn.example.co.uk:8443"]) assert.ok(!isInternalHost(host), host);
  });

  it("redirects the www twin of the canonical host by default", () => {
    assert.equal(canonicalOriginFor({ host: "www.example.com" }, ORIGIN, "www"), ORIGIN);
    assert.equal(canonicalOriginFor({ host: "example.com" }, "https://www.example.com", "www"), "https://www.example.com");
    assert.equal(canonicalOriginFor({ host: "example.com" }, ORIGIN, "www"), null);
    assert.equal(canonicalOriginFor({ host: "EXAMPLE.com:443" }, ORIGIN, "www"), null);
    // Another domain is left alone unless every host is redirected.
    assert.equal(canonicalOriginFor({ host: "old-domain.example.org" }, ORIGIN, "www"), null);
    assert.equal(canonicalOriginFor({ host: "old-domain.example.org" }, ORIGIN, "all"), ORIGIN);
  });

  it("prefers the forwarded host and never touches internal hosts", () => {
    assert.equal(canonicalOriginFor({ host: "lms:3000", forwardedHost: "www.example.com" }, ORIGIN, "www"), ORIGIN);
    assert.equal(canonicalOriginFor({ host: "www.example.com", forwardedHost: "example.com" }, ORIGIN, "www"), null);
    for (const host of ["localhost:3000", "10.0.0.5", "lms", "lms.internal"]) assert.equal(canonicalOriginFor({ host }, ORIGIN, "all"), null, host);
    assert.equal(canonicalOriginFor({ host: null }, ORIGIN, "all"), null);
  });

  it("does nothing when switched off or when APP_URL is a local address", () => {
    assert.equal(canonicalOriginFor({ host: "www.example.com" }, ORIGIN, "off"), null);
    assert.equal(canonicalOriginFor({ host: "www.example.com" }, "http://localhost:3000", "all"), null);
    assert.equal(canonicalOriginFor({ host: "www.example.com" }, "not a url", "all"), null);
  });

  it("strips trailing slashes but keeps the root", () => {
    assert.equal(stripTrailingSlash("/"), "/");
    assert.equal(stripTrailingSlash("/courses/"), "/courses");
    assert.equal(stripTrailingSlash("/courses//"), "/courses");
    assert.equal(stripTrailingSlash("/courses"), "/courses");
    assert.equal(stripTrailingSlash("//"), "/");
  });
});

describe("seoRedirectTarget", () => {
  const none = () => null;
  const target = (pathname: string, opts: { search?: string; host?: string; lookup?: (path: string) => string | null; mode?: "www" | "all" | "off" } = {}) =>
    seoRedirectTarget({ pathname, search: opts.search ?? "", host: opts.host ?? "example.com" }, opts.lookup ?? none, ORIGIN, opts.mode ?? "www");

  it("leaves canonical addresses alone", () => {
    assert.equal(target("/"), null);
    assert.equal(target("/courses/ux-basics"), null);
    assert.equal(target("/courses", { search: "?page=2" }), null);
  });

  it("removes a trailing slash and keeps the query string", () => {
    assert.equal(target("/courses/ux-basics/"), "/courses/ux-basics");
    assert.equal(target("/courses/", { search: "?utm_source=mail" }), "/courses?utm_source=mail");
  });

  it("sends an old slug to the current one", () => {
    const lookup = (path: string) => (path === "/courses/old" ? "/courses/new" : null);
    assert.equal(target("/courses/old", { lookup }), "/courses/new");
    assert.equal(target("/courses/old", { lookup, search: "?ref=x" }), "/courses/new?ref=x");
  });

  it("combines host, trailing slash and slug in a single redirect", () => {
    const lookup = (path: string) => (path === "/courses/old" ? "/courses/new" : null);
    assert.equal(target("/courses/old/", { lookup, host: "www.example.com", search: "?x=1" }), "https://example.com/courses/new?x=1");
    assert.equal(target("/", { host: "www.example.com" }), "https://example.com/");
  });

  it("can never be turned into a redirect to another site", () => {
    assert.equal(target("//evil.example.org/"), "/evil.example.org");
    assert.equal(target("/\\evil.example.org"), "/evil.example.org");
    // A corrupted rule pointing off-site is ignored.
    assert.equal(target("/courses/old", { lookup: () => "//evil.example.org" }), null);
    assert.equal(target("/courses/old", { lookup: () => "https://evil.example.org" }), null);
  });
});

describe("slug suggestions", () => {
  it("lower-cases, hyphenates and trims filler words", () => {
    assert.equal(suggestSlug("Introduction to the Art of Negotiation"), "introduction-art-negotiation");
    assert.equal(suggestSlug("  React & TypeScript: A Practical Guide!  "), "react-typescript-practical-guide");
    assert.equal(suggestSlug("Café Crème"), "cafe-creme");
  });

  it("keeps filler words when too little would remain", () => {
    assert.equal(suggestSlug("What is it"), "what-is-it");
    assert.equal(suggestSlug("To Be"), "to-be");
  });

  it("cuts long titles at a word boundary", () => {
    const slug = suggestSlug("Advanced machine learning engineering with Python and TensorFlow for production systems at scale");
    assert.equal(slug, "advanced-machine-learning-engineering-python-tensorflow");
    assert.ok(slug.length <= SLUG_MAX);
    assert.equal(suggestSlug("a".repeat(200)).length, SLUG_MAX);
  });

  it("always returns a valid slug", () => {
    for (const title of ["", "   ", "!!!", "日本語", "C++ & C#", "100% Pure", "The", "-- dashes --"]) assert.ok(isValidSlug(suggestSlug(title)), JSON.stringify(title));
  });

  it("validates slugs typed by hand", () => {
    for (const ok of ["a", "intro-to-design", "web3", "2026-recap"]) assert.ok(isValidSlug(ok), ok);
    for (const bad of ["", "Intro", "intro_to", "intro--design", "-intro", "intro-", "intro design", "café", "a".repeat(81)]) assert.ok(!isValidSlug(bad), bad);
  });

  it("maps free-text tags to and from their URL form", () => {
    assert.equal(tagSlug("Web Development"), "web-development");
    assert.equal(tagSlug("  UX/UI  "), "ux-ui");
    assert.equal(tagLabel("web-development"), "Web development");
    assert.equal(tagLabel(""), "");
  });
});
