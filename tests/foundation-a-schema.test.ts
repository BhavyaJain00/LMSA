import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Settings } from "@/lib/types";
import { COLLECTIONS, getDb } from "@/lib/db/store";
import { defaultSettings, mergeSettings } from "@/lib/db/defaults";
import { buildSeedBlogPosts, buildSeedLegalPages, LEGAL_TEMPLATE_NOTICE } from "@/lib/db/seed-round3";
import { buildSeedDatabase } from "@/lib/db/seed";
import { buildNavigation } from "@/lib/nav";
import { databaseEnv } from "@/lib/server-env";
import { stripMarkdown } from "@/lib/utils";
import { resetDb } from "./helpers/db";

/**
 * Round 3 wave A foundation: new collections, settings groups (and how older
 * databases pick them up), demo blog/legal content and navigation entries.
 */

const ROUND3_COLLECTIONS = [
  "uploadSessions",
  "transcodeJobs",
  "transcripts",
  "blogPosts",
  "slugRedirects",
  "leads",
  "legalPages",
  "consents",
  "auditEvents",
  "errorEvents",
  "dataRequests",
  "aiConversations",
  "aiMessages",
] as const;

const words = (markdown: string) => stripMarkdown(markdown).split(/\s+/).filter(Boolean).length;

describe("round 3 collections", () => {
  it("registers every new collection exactly once", () => {
    for (const name of ROUND3_COLLECTIONS) assert.ok(COLLECTIONS.includes(name), `${name} is in COLLECTIONS`);
    assert.equal(new Set(COLLECTIONS).size, COLLECTIONS.length, "no duplicates");
  });

  it("creates every collection as an empty array when a database lacks them", async () => {
    const db = await resetDb();
    for (const name of ROUND3_COLLECTIONS) assert.deepEqual(db[name], [], name);
  });

  it("the seed database covers exactly the store collections", async () => {
    const seed = await buildSeedDatabase();
    const keys = Object.keys(seed).filter((k) => k !== "settings").sort();
    assert.deepEqual(keys, [...COLLECTIONS].sort());
    for (const name of COLLECTIONS) assert.ok(Array.isArray(seed[name]), `${name} is an array`);
  });

  it("uses the JSON driver under test (DB_DRIVER parsed from the environment)", async () => {
    assert.equal(databaseEnv.driver, "json");
    assert.ok(databaseEnv.sqlitePath.length > 0);
    assert.ok(await getDb());
  });
});

describe("round 3 settings", () => {
  it("has the documented defaults", () => {
    const d = defaultSettings();
    assert.equal(d.seo.siteTitleTemplate, "%s · LearnLoop");
    assert.equal(d.seo.defaultDescription, d.brand.metaDescription);
    assert.equal(d.seo.organizationName, "LearnLoop Academy");
    assert.deepEqual(d.seo.sameAs, []);
    assert.equal(d.seo.blogEnabled, true);
    assert.equal(d.seo.noindexSite, false);
    assert.deepEqual(d.legal, {
      cookieBanner: true,
      companyName: "LearnLoop Academy",
      companyAddress: undefined,
      contactEmail: undefined,
      dataRetentionDays: 365,
    });
    assert.equal(d.ai.enabled, false);
    assert.equal(d.ai.model, "claude-sonnet-5");
    assert.equal(d.ai.dailyMessageLimit, 30);
    assert.equal(d.ai.reviewQueue, true);
    assert.equal(d.storage.transcodeToHls, true);
    assert.deepEqual(d.storage.renditions, [1080, 720, 480]);
    assert.equal(d.storage.autoTranscribe, false);
  });

  it("fills the new groups in for settings saved before round 3", () => {
    const legacy = structuredClone(defaultSettings()) as Partial<Settings>;
    delete legacy.seo;
    delete legacy.legal;
    delete legacy.ai;
    delete legacy.storage;
    legacy.brand = { ...defaultSettings().brand, name: "Acme Learning" };
    const merged = mergeSettings(legacy);
    assert.equal(merged.brand.name, "Acme Learning", "existing values are kept");
    assert.deepEqual(merged.seo, defaultSettings().seo);
    assert.deepEqual(merged.legal, defaultSettings().legal);
    assert.deepEqual(merged.ai, defaultSettings().ai);
    assert.deepEqual(merged.storage, defaultSettings().storage);
  });

  it("keeps stored values and adds keys introduced later", () => {
    const merged = mergeSettings({
      seo: { ga4Id: "G-TEST123", blogEnabled: false } as Settings["seo"],
      ai: { enabled: true } as Settings["ai"],
    });
    assert.equal(merged.seo.ga4Id, "G-TEST123");
    assert.equal(merged.seo.blogEnabled, false);
    assert.equal(merged.seo.organizationName, "LearnLoop Academy");
    assert.equal(merged.ai.enabled, true);
    assert.equal(merged.ai.dailyMessageLimit, 30);
  });

  it("sanitizes rendition heights and sameAs lists", () => {
    const merged = mergeSettings({
      storage: { renditions: [480, "720", 720, 99999, -1, 1.5, 360] as unknown as number[] } as Settings["storage"],
      seo: { sameAs: ["https://x.com/learnloop", 42, null] as unknown as string[] } as Settings["seo"],
    });
    assert.deepEqual(merged.storage.renditions, [720, 480, 360], "unique, in range, highest first");
    assert.deepEqual(merged.seo.sameAs, ["https://x.com/learnloop"]);
    assert.deepEqual(mergeSettings({ storage: { renditions: [] as number[] } as Settings["storage"] }).storage.renditions, [1080, 720, 480]);
    assert.deepEqual(mergeSettings({ storage: { renditions: "720" as unknown as number[] } as Settings["storage"] }).storage.renditions, [1080, 720, 480]);
  });
});

describe("round 3 demo content", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("seeds two substantial, published blog posts by Maya", () => {
    const posts = buildSeedBlogPosts(now);
    assert.equal(posts.length, 2);
    assert.equal(new Set(posts.map((p) => p.slug)).size, 2, "unique slugs");
    for (const post of posts) {
      assert.equal(post.status, "published");
      assert.equal(post.authorId, "usr_maya");
      assert.deepEqual(post.relatedCourseIds, ["crs_js", "crs_react"]);
      assert.ok(words(post.content) >= 600, `${post.slug} has ${words(post.content)} words`);
      assert.ok((post.content.match(/^## /gm) ?? []).length >= 4, `${post.slug} has headings`);
      assert.equal(post.faq?.length, 3);
      assert.ok(post.readingTimeSeconds > 0);
      assert.ok(post.publishedAt && post.publishedAt <= now.toISOString(), "already published");
      assert.ok(post.excerpt.length > 40 && post.seoDescription && post.seoDescription.length <= 160);
      assert.match(post.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("seeds unpublished legal templates that say they need review", () => {
    const pages = buildSeedLegalPages(now);
    assert.deepEqual(pages.map((p) => p.slug), ["privacy", "terms", "refunds", "cookies"]);
    for (const page of pages) {
      assert.equal(page.published, false);
      assert.equal(page.version, 1);
      assert.equal(page.content.split("\n")[0], LEGAL_TEMPLATE_NOTICE);
      assert.equal(LEGAL_TEMPLATE_NOTICE, "Template — review with a lawyer before publishing.");
      assert.ok(words(page.content) > 120, `${page.slug} has real starter text`);
    }
  });

  it("references users, courses and categories that exist in the demo data", async () => {
    const seed = await buildSeedDatabase();
    const users = new Set(seed.users.map((u) => u.id));
    const courses = new Set(seed.courses.map((c) => c.id));
    const categories = new Set(seed.categories.map((c) => c.id));
    assert.equal(seed.blogPosts.length, 2);
    assert.equal(seed.legalPages.length, 4);
    for (const post of seed.blogPosts) {
      assert.ok(users.has(post.authorId));
      for (const id of post.relatedCourseIds) assert.ok(courses.has(id), id);
      for (const id of post.categoryIds) assert.ok(categories.has(id), id);
    }
  });
});

describe("round 3 navigation", () => {
  const admin = { id: "usr_admin", username: "admin", name: "Admin", email: "a@x.test", roles: ["admin"], enabled: true, createdAt: "" } as const;
  const creator = { ...admin, id: "usr_c", username: "c", roles: ["course_creator"] } as const;
  const student = { ...admin, id: "usr_s", username: "s", roles: ["student"] } as const;
  const hrefs = (sections: ReturnType<typeof buildNavigation>) => sections.flatMap((s) => s.items.map((i) => i.href));

  it("shows the public blog only when it is enabled", () => {
    const on = defaultSettings();
    const off = { ...on, seo: { ...on.seo, blogEnabled: false } };
    assert.ok(hrefs(buildNavigation(null, on)).includes("/blog"));
    assert.ok(!hrefs(buildNavigation(null, off)).includes("/blog"));
  });

  it("gives staff the blog manager and, once the tutor is on, the AI review queue", () => {
    const settings = defaultSettings();
    const withAi = { ...settings, ai: { ...settings.ai, enabled: true } };
    assert.ok(hrefs(buildNavigation({ ...creator, roles: [...creator.roles] }, settings)).includes("/admin/blog"));
    assert.ok(!hrefs(buildNavigation({ ...creator, roles: [...creator.roles] }, settings)).includes("/admin/ai"));
    assert.ok(hrefs(buildNavigation({ ...creator, roles: [...creator.roles] }, withAi)).includes("/admin/ai"));
    assert.ok(hrefs(buildNavigation({ ...admin, roles: [...admin.roles] }, withAi)).includes("/admin/ai"));
    const studentLinks = hrefs(buildNavigation({ ...student, roles: [...student.roles] }, withAi));
    assert.ok(!studentLinks.includes("/admin/blog") && !studentLinks.includes("/admin/ai"));
  });
});
