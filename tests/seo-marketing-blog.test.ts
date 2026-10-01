import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BlogPost, Category } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { bulkPostAction, deletePostAction, duplicatePostAction, savePostAction } from "@/lib/actions/blog";
import {
  authorProfilePath,
  canEditPost,
  getAdminPosts,
  getBlogCategoryLanding,
  getBlogTagLanding,
  getPostBySlug,
  getPostEditorOptions,
  getPublicPosts,
  getRelatedPosts,
  publishDuePosts,
  recordPostView,
} from "@/lib/data/blog";
import {
  autoExcerpt,
  buildToc,
  bulkPublishState,
  chooseSlug,
  isAssetUrl,
  isBulkPostOperation,
  isLikelyBot,
  normalizeFaq,
  normalizeTags,
  parseAdminPostFilter,
  parsePostInput,
  postDocumentTitle,
  publishBlockers,
  resolvePublishState,
  shareLinks,
  stripCodeFences,
  type RawPostInput,
} from "@/lib/seo/blog";
import { blogArchiveTrail, postTrail } from "@/lib/seo/breadcrumbs";
import { analyzeSeo, containsKeyword, countKeyword, firstParagraph, seoScore, subheadings } from "@/lib/seo/focus-keyword";
import { makeCourse, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Blog CMS (item 8): pure editor rules (publish state, form parsing, TOC,
 * focus-keyword checks), the public queries (only published posts, scheduled
 * posts going live lazily, archives) and the Server Actions (permissions,
 * slugs, bulk operations).
 */

const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();
const BODY = "JavaScript is the language of the web. ".repeat(20);

let n = 0;
function makePost(overrides: Partial<BlogPost> = {}): BlogPost {
  const id = overrides.id ?? `post_t${++n}`;
  return {
    id,
    slug: overrides.slug ?? `post-${n}`,
    title: `Post ${n}`,
    excerpt: "An excerpt.",
    content: BODY,
    authorId: "usr_writer",
    categoryIds: [],
    tags: [],
    status: "published",
    publishedAt: iso(-1),
    relatedCourseIds: [],
    readingTimeSeconds: 60,
    views: 0,
    createdAt: iso(-2),
    updatedAt: iso(-1),
    ...overrides,
  };
}

const CATS: Category[] = [
  { id: "cat_web", name: "Web development", slug: "web-development" },
  { id: "cat_data", name: "Data science", slug: "data-science" },
  { id: "cat_empty", name: "Design", slug: "design" },
];

function rawInput(overrides: Partial<RawPostInput> = {}): RawPostInput {
  return {
    title: "Learn JavaScript fast",
    slug: "",
    excerpt: "",
    content: BODY,
    coverImageUrl: "",
    categoryIds: [],
    tags: "",
    relatedCourseIds: [],
    faq: "",
    seoTitle: "",
    seoDescription: "",
    canonicalUrl: "",
    focusKeyword: "",
    noindex: false,
    status: "draft",
    publishedAt: "",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("blog publish state", () => {
  it("publishes now, schedules future dates and keeps draft dates", () => {
    assert.deepEqual(resolvePublishState("published", undefined, NOW), { status: "published", publishedAt: new Date(NOW).toISOString() });
    assert.deepEqual(resolvePublishState("published", iso(2), NOW), { status: "scheduled", publishedAt: iso(2) });
    assert.deepEqual(resolvePublishState("scheduled", iso(-1), NOW), { status: "published", publishedAt: iso(-1) });
    assert.deepEqual(resolvePublishState("scheduled", iso(3), NOW), { status: "scheduled", publishedAt: iso(3) });
    assert.ok("error" in resolvePublishState("scheduled", undefined, NOW));
    assert.deepEqual(resolvePublishState("draft", iso(5), NOW), { status: "draft", publishedAt: iso(5) });
  });

  it("bulk publish keeps the original date of published posts and future dates", () => {
    assert.deepEqual(bulkPublishState({ status: "draft" }, NOW), { status: "published", publishedAt: new Date(NOW).toISOString() });
    assert.deepEqual(bulkPublishState({ status: "draft", publishedAt: iso(-10) }, NOW), { status: "published", publishedAt: new Date(NOW).toISOString() });
    assert.deepEqual(bulkPublishState({ status: "draft", publishedAt: iso(4) }, NOW), { status: "scheduled", publishedAt: iso(4) });
    assert.deepEqual(bulkPublishState({ status: "published", publishedAt: iso(-10) }, NOW), { status: "published", publishedAt: iso(-10) });
  });

  it("refuses to publish empty articles", () => {
    assert.equal(publishBlockers({ title: "", content: BODY }), "has no title");
    assert.equal(publishBlockers({ title: "T", content: "Too short" }), "has no content yet");
    assert.equal(publishBlockers({ title: "T", content: BODY }), null);
  });
});

describe("blog editor parsing", () => {
  const ctx = { categoryIds: new Set(["cat_web", "cat_data"]), courseIds: new Set(["crs_a"]), now: NOW };

  it("normalises fields and drops unknown categories and courses", () => {
    const { value, errors } = parsePostInput(
      rawInput({
        title: "  Learn   JavaScript fast ",
        categoryIds: ["cat_web", "cat_gone", "cat_web"],
        relatedCourseIds: ["crs_a", "crs_deleted"],
        tags: "JavaScript, javascript,  Beginners ,,",
        faq: JSON.stringify([{ question: "Q?", answer: "A." }, { question: "", answer: "orphan" }]),
        seoTitle: "  JS   guide ",
      }),
      ctx,
    );
    assert.deepEqual(errors, {});
    assert.equal(value.title, "Learn JavaScript fast");
    assert.deepEqual(value.categoryIds, ["cat_web"]);
    assert.deepEqual(value.relatedCourseIds, ["crs_a"]);
    assert.deepEqual(value.tags, ["JavaScript", "Beginners"]);
    assert.deepEqual(value.faq, [{ question: "Q?", answer: "A." }]);
    assert.equal(value.seoTitle, "JS guide");
    assert.equal(value.status, "draft");
  });

  it("requires a title, real content to publish, a date to schedule and valid URLs", () => {
    const { errors } = parsePostInput(rawInput({ title: "", content: "Short", status: "published", canonicalUrl: "example.com/post", coverImageUrl: "javascript:alert(1)" }), ctx);
    assert.ok(errors.title);
    assert.ok(errors.content);
    assert.ok(errors.canonicalUrl);
    assert.ok(errors.coverImageUrl);
    assert.ok(parsePostInput(rawInput({ status: "scheduled" }), ctx).errors.publishedAt);
    assert.ok(parsePostInput(rawInput({ slug: "Not A Slug" }), ctx).errors.slug);
    assert.ok(parsePostInput(rawInput({ faq: "{broken" }), ctx).errors.faq);
    // Drafts may be empty.
    assert.deepEqual(parsePostInput(rawInput({ content: "" }), ctx).errors, {});
  });

  it("turns a future publish date into a schedule", () => {
    const { value } = parsePostInput(rawInput({ status: "published", publishedAt: iso(2) }), ctx);
    assert.equal(value.status, "scheduled");
    assert.equal(value.publishedAt, iso(2));
  });

  it("caps categories and related courses", () => {
    const many = { categoryIds: new Set(["a", "b", "c", "d", "e", "f"]), courseIds: new Set<string>(), now: NOW };
    const { errors, value } = parsePostInput(rawInput({ categoryIds: ["a", "b", "c", "d", "e", "f"] }), many);
    assert.ok(errors.categoryIds);
    assert.equal(value.categoryIds.length, 5);
  });

  it("chooses slugs, tags, FAQ and excerpts sensibly", () => {
    assert.equal(chooseSlug("", "The Complete Guide to CSS Grid"), "complete-guide-css-grid");
    assert.equal(chooseSlug("my-post", "Anything"), "my-post");
    assert.equal(chooseSlug("Bad Slug!", "CSS Grid basics"), "css-grid-basics");
    assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 12);
    assert.deepEqual(normalizeFaq("nope"), []);
    assert.deepEqual(normalizeFaq([{ question: " Q ", answer: " A " }, null, { question: 1 }]), [{ question: "Q", answer: "A" }]);
    const excerpt = autoExcerpt(`# Title\n\n${"Sentence one is here. ".repeat(30)}`);
    assert.ok(excerpt.length <= 220 && excerpt.endsWith("."));
    assert.ok(!autoExcerpt("```\n# not a heading\n```\nReal text.").includes("not a heading"));
    assert.equal(stripCodeFences("a\n```js\n# x\n```\nb"), "a\nb");
    assert.equal(isAssetUrl("/uploads/a.png"), true);
    assert.equal(isAssetUrl("//evil.example/a.png"), false);
    assert.equal(postDocumentTitle({ title: "Headline", seoTitle: " " }), "Headline");
    assert.equal(postDocumentTitle({ title: "Headline", seoTitle: "SEO title" }), "SEO title");
  });

  it("parses admin filters and bulk operations", () => {
    assert.equal(parseAdminPostFilter("scheduled"), "scheduled");
    assert.equal(parseAdminPostFilter(["draft"]), "draft");
    assert.equal(parseAdminPostFilter("bogus"), "all");
    assert.equal(isBulkPostOperation("noindex"), true);
    assert.equal(isBulkPostOperation("archive"), false);
  });
});

describe("blog reading helpers", () => {
  it("builds a table of contents from H2/H3 headings only", () => {
    const headings = [
      { level: 1, text: "Title", id: "title" },
      { level: 2, text: "Why **JavaScript**", id: "why-javascript" },
      { level: 3, text: "History", id: "history" },
      { level: 2, text: "Why **JavaScript**", id: "why-javascript" },
      { level: 4, text: "Deep", id: "deep" },
      { level: 2, text: "Next steps", id: "next-steps" },
    ];
    assert.deepEqual(buildToc(headings), [
      { id: "why-javascript", text: "Why JavaScript", level: 2 },
      { id: "history", text: "History", level: 3 },
      { id: "next-steps", text: "Next steps", level: 2 },
    ]);
    assert.deepEqual(buildToc(headings.slice(0, 3)), [], "fewer than three entries: no TOC");
  });

  it("does not count bots as readers", () => {
    assert.equal(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
    assert.equal(isLikelyBot("facebookexternalhit/1.1"), true);
    assert.equal(isLikelyBot(null), true);
    assert.equal(isLikelyBot("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36"), false);
  });

  it("builds share links without scripts and encodes the URL", () => {
    const links = shareLinks("https://lms.test/blog/a b", "Hello & bye");
    assert.ok(links.every((l) => !l.href.includes(" ")));
    assert.ok(links.find((l) => l.network === "email")!.href.startsWith("mailto:"));
  });

  it("builds breadcrumb trails for articles and archives", () => {
    assert.deepEqual(
      postTrail({ title: "Post" }, { name: "Web", slug: "web" }).map((c) => c.path ?? null),
      ["/", "/blog", "/blog/category/web", null],
    );
    assert.deepEqual(postTrail({ title: "Post" }, null).map((c) => c.name), ["Home", "Blog", "Post"]);
    assert.deepEqual(blogArchiveTrail("CSS").map((c) => c.name), ["Home", "Blog", "CSS"]);
  });
});

describe("focus-keyword checks", () => {
  const content = [
    "Learning the javascript roadmap step by step helps beginners stay focused.",
    "",
    "## Why a JavaScript roadmap matters",
    "",
    "Some text. ".repeat(150),
    "",
    "## Next steps",
    "",
    "Follow the javascript roadmap and build projects.",
  ].join("\n");
  const input = {
    keyword: "JavaScript roadmap",
    seoTitle: "JavaScript Roadmap for 2026 · LearnLoop",
    h1: "A practical JavaScript roadmap",
    content,
    slug: "javascript-roadmap",
    metaDescription: "A step-by-step JavaScript roadmap: fundamentals, async code, the DOM and frameworks, with a realistic timeline for beginners.",
  };

  it("passes when the keyword is in the title, H1, intro, slug, description and a subheading", () => {
    const checks = analyzeSeo(input);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    for (const id of ["keyword-title", "keyword-h1", "keyword-intro", "keyword-slug", "keyword-description", "keyword-subheading"]) assert.equal(byId[id], "pass", id);
    assert.match(checks.find((c) => c.id === "keyword-title")!.detail, /Leads the title/);
  });

  it("flags each missing placement", () => {
    const checks = analyzeSeo({ ...input, seoTitle: "Learn to code", h1: "Learn to code", slug: "learn-to-code", metaDescription: "" });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    assert.equal(byId["keyword-title"], "fail");
    assert.equal(byId["keyword-h1"], "warn");
    assert.equal(byId["keyword-slug"], "warn");
    assert.equal(byId["keyword-description"], "warn");
    assert.equal(byId["description-length"], "warn");
  });

  it("asks for a keyword and penalises thin content", () => {
    const checks = analyzeSeo({ ...input, keyword: "", content: "Short." });
    assert.equal(checks[0]!.id, "keyword");
    assert.equal(checks[0]!.status, "fail");
    assert.equal(checks.find((c) => c.id === "content-length")!.status, "fail");
    assert.ok(seoScore(checks) < seoScore(analyzeSeo(input)));
  });

  it("matches whole words, ignoring case, accents and punctuation", () => {
    assert.equal(containsKeyword("Le CAFÉ, crème!", "cafe creme"), true);
    assert.equal(containsKeyword("javascripting", "javascript"), false);
    assert.equal(countKeyword("JS js. js-js", "js"), 4);
    assert.equal(firstParagraph("# Title\n\n![img](a.png)\n\nThe **intro** text."), "The intro text.");
    assert.deepEqual(subheadings("# A\n## B\n### C ###\ntext"), ["B", "C"]);
    assert.equal(seoScore([]), 0);
  });
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

describe("blog queries", () => {
  const writer = makeUser({ id: "usr_writer", username: "writer", name: "Wendy Writer", roles: ["course_creator"] });
  const other = makeUser({ id: "usr_other", username: "other", roles: ["course_creator"] });
  const mod = makeUser({ id: "usr_mod", username: "mod", roles: ["moderator"] });

  beforeEach(async () => {
    await resetDb({
      users: [writer, other, mod],
      categories: CATS,
      courses: [makeCourse({ id: "crs_pub", slug: "pub", published: true, instructorIds: ["usr_writer"] })],
      blogPosts: [
        makePost({ id: "p_old", slug: "old", title: "Old JavaScript tips", categoryIds: ["cat_web"], tags: ["JavaScript", "Tips"], publishedAt: iso(-30) }),
        makePost({ id: "p_new", slug: "new", title: "New CSS tricks", categoryIds: ["cat_web"], tags: ["CSS", "tips"], publishedAt: iso(-1) }),
        makePost({ id: "p_data", slug: "data", title: "Pandas intro", categoryIds: ["cat_data"], tags: ["Python"], authorId: "usr_other", publishedAt: iso(-5) }),
        makePost({ id: "p_draft", slug: "draft", title: "Unfinished", status: "draft", categoryIds: ["cat_empty"], tags: ["Secret"] }),
        makePost({ id: "p_future", slug: "future", title: "Coming soon", status: "scheduled", publishedAt: new Date(Date.now() + 5 * DAY).toISOString(), categoryIds: ["cat_empty"] }),
        makePost({ id: "p_due", slug: "due", title: "Due now", status: "scheduled", publishedAt: new Date(Date.now() - 60_000).toISOString() }),
      ],
    });
  });

  it("lists only public posts, newest first, with search, tag and paging", async () => {
    const all = await getPublicPosts();
    assert.deepEqual(all.items.map((p) => p.id), ["p_due", "p_new", "p_data", "p_old"]);
    assert.equal(all.items[1]!.author?.name, "Wendy Writer");
    assert.equal("email" in all.items[1]!.author!, false, "authors are rendered without their email");
    assert.deepEqual((await getPublicPosts({ search: "pandas" })).items.map((p) => p.id), ["p_data"]);
    assert.deepEqual((await getPublicPosts({ tag: "tips" })).items.map((p) => p.id), ["p_new", "p_old"]);
    const page2 = await getPublicPosts({ pageSize: 3, page: 2 });
    assert.equal(page2.pages, 2);
    assert.deepEqual(page2.items.map((p) => p.id), ["p_old"]);
    assert.equal((await getPublicPosts({ pageSize: 3, page: 99 })).page, 2, "out-of-range pages clamp");
  });

  it("publishes due scheduled posts lazily and notifies the author once", async () => {
    assert.equal(await publishDuePosts(), 1);
    assert.equal(await publishDuePosts(), 0);
    const db = await getDb();
    assert.equal(db.blogPosts.find((p) => p.id === "p_due")!.status, "published");
    assert.equal(db.blogPosts.find((p) => p.id === "p_future")!.status, "scheduled");
    const notes = db.notifications.filter((x) => x.userId === "usr_writer" && x.dedupeKey === "blog-live:p_due");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.link, "/blog/due");
  });

  it("serves category and topic archives only for public content", async () => {
    const web = await getBlogCategoryLanding("web-development");
    assert.ok(web);
    assert.deepEqual(web.posts.items.map((p) => p.id), ["p_new", "p_old"]);
    assert.deepEqual(web.otherCategories.map((c) => c.slug), ["data-science"]);
    assert.equal(await getBlogCategoryLanding("design"), null, "only drafts and future posts: no archive");
    const tips = await getBlogTagLanding("tips");
    assert.ok(tips);
    assert.equal(tips.label === "Tips" || tips.label === "tips", true);
    assert.deepEqual(tips.relatedTags.map((t) => t.slug).sort(), ["css", "javascript"]);
    assert.equal(await getBlogTagLanding("secret"), null);
  });

  it("relates posts by category and topic", async () => {
    const post = (await getPostBySlug("old"))!.post;
    assert.equal((await getRelatedPosts(post, 2))[0]!.id, "p_new");
    const draft = await getPostBySlug("draft");
    assert.equal(draft?.isPublic, false);
    assert.equal(draft?.status, "draft");
  });

  it("scopes the admin list to the writer and counts statuses", async () => {
    const own = await getAdminPosts(writer, { status: "all" });
    assert.equal(own.rows.some((r) => r.id === "p_data"), false);
    assert.equal(own.counts.scheduled, 1);
    assert.equal(own.counts.draft, 1);
    const everything = await getAdminPosts(mod, { status: "all", pageSize: 2 });
    assert.equal(everything.total, 6);
    assert.equal(everything.pages, 3);
    assert.deepEqual((await getAdminPosts(mod, { status: "draft" })).rows.map((r) => r.id), ["p_draft"]);
    assert.deepEqual((await getAdminPosts(mod, { status: "all", search: "pandas" })).rows.map((r) => r.id), ["p_data"]);
  });

  it("checks edit rights and editor options", async () => {
    assert.equal(canEditPost(writer, { authorId: "usr_writer" }), true);
    assert.equal(canEditPost(writer, { authorId: "usr_other" }), false);
    assert.equal(canEditPost(mod, { authorId: "usr_other" }), true);
    assert.equal(canEditPost(makeUser({ roles: ["student"] }), { authorId: "x" }), false);
    assert.deepEqual((await getPostEditorOptions(writer)).authors, []);
    assert.deepEqual((await getPostEditorOptions(mod)).authors.map((a) => a.id).sort(), ["usr_mod", "usr_other", "usr_writer"]);
    assert.equal(await authorProfilePath("usr_writer"), "/instructors/writer");
    assert.equal(await authorProfilePath("usr_other"), "/user/other");
  });

  it("counts views", async () => {
    await recordPostView("p_new");
    await recordPostView("p_new");
    assert.equal((await getDb()).blogPosts.find((p) => p.id === "p_new")!.views, 2);
  });
});

/* ------------------------------------------------------------------ */
/* Server Actions                                                      */
/* ------------------------------------------------------------------ */

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  return fd;
}

async function login(userId: string) {
  resetRequest();
  await createSession(userId);
}

describe("blog actions", () => {
  beforeEach(async () => {
    await resetDb({
      users: [
        makeUser({ id: "usr_writer", username: "writer", roles: ["course_creator"] }),
        makeUser({ id: "usr_other", username: "other", roles: ["course_creator"] }),
        makeUser({ id: "usr_mod", username: "mod", roles: ["moderator"] }),
        makeUser({ id: "usr_student", username: "student", roles: ["student"] }),
      ],
      categories: CATS,
      blogPosts: [makePost({ id: "p_taken", slug: "javascript-guide", authorId: "usr_other" }), makePost({ id: "p_mine", slug: "mine", authorId: "usr_writer", status: "draft" })],
    });
  });

  it("creates a draft with a unique slug, excerpt and reading time", async () => {
    await login("usr_writer");
    const result = await savePostAction(null, form({ title: "JavaScript guide", content: BODY, status: "draft", categoryIds: ["cat_web", "cat_nope"], tags: "JS, js" }));
    assert.ok(result.ok, !result.ok ? result.error : "");
    const post = (await getDb()).blogPosts.find((p) => p.id === result.data.id)!;
    assert.equal(post.slug, "javascript-guide-2");
    assert.equal(post.authorId, "usr_writer");
    assert.deepEqual(post.categoryIds, ["cat_web"]);
    assert.deepEqual(post.tags, ["JS"]);
    assert.ok(post.excerpt.length > 0);
    assert.ok(post.readingTimeSeconds > 0);
    assert.equal(post.status, "draft");
  });

  it("rejects a typed slug that is taken and students altogether", async () => {
    await login("usr_writer");
    const taken = await savePostAction(null, form({ title: "Guide", slug: "javascript-guide", content: BODY }));
    assert.equal(taken.ok, false);
    assert.ok(!taken.ok && taken.fieldErrors?.slug);
    await login("usr_student");
    assert.equal((await savePostAction(null, form({ title: "Guide", content: BODY }))).ok, false);
  });

  it("lets writers edit only their own articles; moderators may reassign authors", async () => {
    await login("usr_writer");
    const denied = await savePostAction(null, form({ id: "p_taken", title: "Hijack", content: BODY }));
    assert.equal(denied.ok, false);
    const ok = await savePostAction(null, form({ id: "p_mine", title: "Mine", slug: "mine", content: BODY, status: "published", authorId: "usr_mod" }));
    assert.ok(ok.ok);
    const mine = (await getDb()).blogPosts.find((p) => p.id === "p_mine")!;
    assert.equal(mine.status, "published");
    assert.equal(mine.authorId, "usr_writer", "writers cannot reassign");
    await login("usr_mod");
    const moved = await savePostAction(null, form({ id: "p_mine", title: "Mine", slug: "mine", content: BODY, status: "published", authorId: "usr_other" }));
    assert.ok(moved.ok);
    assert.equal((await getDb()).blogPosts.find((p) => p.id === "p_mine")!.authorId, "usr_other");
    const bad = await savePostAction(null, form({ id: "p_mine", title: "Mine", slug: "mine", content: BODY, authorId: "usr_student" }));
    assert.ok(!bad.ok && bad.fieldErrors?.authorId);
  });

  it("schedules future posts", async () => {
    await login("usr_writer");
    const at = new Date(Date.now() + 3 * DAY).toISOString();
    const result = await savePostAction(null, form({ title: "Later", content: BODY, status: "published", publishedAt: at }));
    assert.ok(result.ok);
    assert.equal(result.message, "Article scheduled");
    const post = (await getDb()).blogPosts.find((p) => p.id === result.data.id)!;
    assert.equal(post.status, "scheduled");
    assert.equal(post.publishedAt, at);
  });

  it("bulk publishes, skips what the user may not touch and deletes", async () => {
    await login("usr_writer");
    const result = await bulkPostAction(["p_mine", "p_taken"], "publish");
    assert.ok(result.ok);
    assert.deepEqual(result.data, { changed: 1, skipped: 1 });
    assert.equal((await getDb()).blogPosts.find((p) => p.id === "p_mine")!.status, "published");
    assert.equal((await bulkPostAction([], "publish")).ok, false);
    assert.equal((await bulkPostAction(["p_mine"], "archive" as never)).ok, false);
    const noindex = await bulkPostAction(["p_mine"], "noindex");
    assert.ok(noindex.ok);
    assert.equal((await getDb()).blogPosts.find((p) => p.id === "p_mine")!.noindex, true);
    const removed = await bulkPostAction(["p_mine"], "delete");
    assert.ok(removed.ok);
    assert.equal((await getDb()).blogPosts.some((p) => p.id === "p_mine"), false);
  });

  it("refuses to bulk publish an empty draft", async () => {
    await login("usr_writer");
    const db = await getDb();
    db.blogPosts.find((p) => p.id === "p_mine")!.content = "";
    const result = await bulkPostAction(["p_mine"], "publish");
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /no content/);
  });

  it("duplicates as a draft and deletes with permission checks", async () => {
    await login("usr_writer");
    const copy = await duplicatePostAction("p_mine");
    assert.ok(copy.ok);
    const row = (await getDb()).blogPosts.find((p) => p.id === copy.data.id)!;
    assert.equal(row.status, "draft");
    assert.equal(row.slug, "mine-copy");
    assert.equal(row.views, 0);
    assert.equal((await deletePostAction("p_taken")).ok, false);
    assert.ok((await deletePostAction("p_mine")).ok);
    assert.equal((await deletePostAction("p_mine")).ok, false);
  });
});
