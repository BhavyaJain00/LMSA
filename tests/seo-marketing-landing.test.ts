import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BlogPost, JobOpening, LegalPage, Program, Review } from "@/lib/types";
import {
  catalogIsPublic,
  getCategoryDirectory,
  getCategoryLanding,
  getCourseArticles,
  getCourseTags,
  getFooterData,
  getHtmlSitemap,
  getIndexingOverview,
  getInstructorDirectory,
  getInstructorProfile,
  getPublicCourseSummaries,
  getResourceHints,
  getTagLanding,
  listRedirects,
  requireCatalogAccess,
  socialUrls,
} from "@/lib/data/seo";
import { hasFullFooter, socialLabel } from "@/lib/seo/footer";
import {
  DEFAULT_LANDING_SORT,
  INSTRUCTORS_PAGE_SIZE,
  LANDING_PAGE_SIZE,
  TAG_MIN_COURSES_TO_INDEX,
  isTagIndexable,
  landingHref,
  paginate,
  parseLandingSort,
  parsePageParam,
} from "@/lib/seo/landing";
import { MAX_DNS_PREFETCH, MAX_PRECONNECT, externalOrigin, resourceHints } from "@/lib/seo/resource-hints";
import { parseCategorySeo, CATEGORY_SEO_LIMITS } from "@/lib/seo/settings";
import { type Fixture, makeBatch, makeCourse, makeEnrollment, makeUser, resetDb } from "./helpers/db";

/**
 * Internal linking: category, topic and instructor landing pages, related
 * articles, the site footer and the HTML sitemap only ever show what an
 * anonymous visitor may open. Plus the pure paging/sorting rules those pages
 * share and the resource hints for media hosts.
 */

function post(overrides: Partial<BlogPost> & Pick<BlogPost, "id" | "slug" | "title">): BlogPost {
  return {
    excerpt: "Summary.",
    content: "Body.",
    authorId: "usr_ada",
    categoryIds: [],
    tags: [],
    status: "published",
    publishedAt: "2025-06-10T09:00:00.000Z",
    relatedCourseIds: [],
    readingTimeSeconds: 180,
    views: 0,
    createdAt: "2025-06-09T09:00:00.000Z",
    updatedAt: "2025-06-10T09:00:00.000Z",
    ...overrides,
  };
}

const review = (id: string, courseId: string, userId: string, rating: Review["rating"]): Review => ({ id, courseId, userId, rating, review: "Clear and practical.", createdAt: "2026-01-12T00:00:00.000Z" });

const program = (id: string, slug: string, published: boolean): Program => ({
  id,
  slug,
  title: slug === "design-track" ? "Design track" : "Hidden track",
  published,
  enforceCourseOrder: false,
  courseIds: [],
  createdById: "usr_ada",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const job = (id: string, slug: string, status: JobOpening["status"]): JobOpening => ({
  id,
  slug,
  title: status === "open" ? "Product designer" : "Closed role",
  company: "Acme",
  location: "Berlin",
  remote: false,
  type: "full_time",
  description: "Design things.",
  postedById: "usr_ada",
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const legal = (slug: string, title: string, published: boolean): LegalPage => ({ id: `legal_${slug}`, slug, title, content: "Text", updatedAt: "2026-01-02T00:00:00.000Z", version: 1, published });

function fixture(settings: Fixture["settings"] = {}): Fixture {
  return {
    settings: { ...settings, brand: { name: "LearnLoop", tagline: "Learn by doing", ...(settings.brand ?? {}) } },
    users: [
      makeUser({ id: "usr_ada", username: "ada", name: "Ada Lovelace", headline: "Design lead", bio: "Twenty years of product design.", skills: ["Figma", "Research"], roles: ["course_creator"], socials: { linkedin: "https://www.linkedin.com/in/ada", website: "ada.example" } }),
      makeUser({ id: "usr_bob", username: "bob", name: "Bob Stone", roles: ["course_creator"] }),
      makeUser({ id: "usr_zed", username: "zed", name: "Zed Gone", enabled: false, roles: ["course_creator"] }),
      makeUser({ id: "usr_eve", username: "eve", name: "Eve Learner" }),
      makeUser({ id: "usr_sam", username: "sam", name: "Sam Learner" }),
    ],
    categories: [
      { id: "cat_design", name: "Design", slug: "design", intro: "Learn **design** from research to polished interfaces.", seoDescription: "Design courses for every level." },
      { id: "cat_dev", name: "Development", slug: "development" },
      { id: "cat_empty", name: "Marketing", slug: "marketing" },
    ],
    courses: [
      makeCourse({ id: "crs_ux", slug: "ux-basics", title: "UX basics", categoryId: "cat_design", tags: ["UX", "Figma"], instructorIds: ["usr_ada"], imageUrl: "https://img.example.net/ux.png" }),
      makeCourse({ id: "crs_figma", slug: "figma-advanced", title: "Advanced Figma", categoryId: "cat_design", tags: ["figma", "Prototyping"], instructorIds: ["usr_ada", "usr_bob"], imageUrl: "https://img.example.net/figma.png" }),
      makeCourse({ id: "crs_js", slug: "javascript", title: "JavaScript", categoryId: "cat_dev", tags: ["JavaScript"], instructorIds: ["usr_bob"], imageUrl: "/uploads/js.png" }),
      makeCourse({ id: "crs_draft", slug: "draft-course", title: "Draft course", published: false, categoryId: "cat_dev", tags: ["Secret"], instructorIds: ["usr_eve"] }),
      makeCourse({ id: "crs_later", slug: "scheduled-course", title: "Scheduled course", publishAt: "2999-01-01T00:00:00.000Z", categoryId: "cat_empty", tags: ["Secret"], instructorIds: ["usr_zed"] }),
    ],
    enrollments: [
      makeEnrollment({ userId: "usr_eve", courseId: "crs_ux" }),
      makeEnrollment({ userId: "usr_sam", courseId: "crs_ux" }),
      makeEnrollment({ userId: "usr_eve", courseId: "crs_figma" }),
    ],
    reviews: [review("rev_1", "crs_ux", "usr_eve", 5), review("rev_2", "crs_ux", "usr_sam", 4)],
    batches: [makeBatch({ id: "bat_open", slug: "spring-cohort", title: "Spring cohort" }), makeBatch({ id: "bat_private", slug: "private-cohort", title: "Private cohort", published: false })],
    programs: [program("prg_pub", "design-track", true), program("prg_hidden", "hidden-track", false)],
    jobs: [job("job_open", "product-designer", "open"), job("job_closed", "closed-role", "closed")],
    blogPosts: [
      post({ id: "pst_figma", slug: "figma-tips", title: "Ten Figma tips", categoryIds: ["cat_design"], tags: ["Figma"], relatedCourseIds: ["crs_ux"], publishedAt: "2025-06-12T09:00:00.000Z" }),
      post({ id: "pst_js", slug: "js-patterns", title: "JavaScript patterns", authorId: "usr_bob", categoryIds: ["cat_dev"], tags: ["JavaScript"] }),
      post({ id: "pst_draft", slug: "draft-post", title: "Draft post", status: "draft", publishedAt: undefined, categoryIds: ["cat_design"], relatedCourseIds: ["crs_ux"] }),
      post({ id: "pst_noindex", slug: "thin-post", title: "Thin post", noindex: true, publishedAt: "2025-06-01T09:00:00.000Z" }),
    ],
    legalPages: [legal("privacy", "Privacy policy", true), legal("terms", "Terms of service", false)],
  };
}

const slugs = (list: { slug: string }[]) => list.map((item) => item.slug);
const hrefs = (list: { href: string }[]) => list.map((item) => item.href);

describe("landing page rules", () => {
  it("parses the sort order, falling back to the default", () => {
    assert.equal(DEFAULT_LANDING_SORT, "popular");
    assert.equal(parseLandingSort("newest"), "newest");
    assert.equal(parseLandingSort(["rating", "newest"]), "rating");
    assert.equal(parseLandingSort("title"), "popular");
    assert.equal(parseLandingSort(undefined), "popular");
  });

  it("parses the page number defensively", () => {
    assert.equal(parsePageParam("3"), 3);
    assert.equal(parsePageParam(["2", "9"]), 2);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "1e3", "12345678", " 2"]) assert.equal(parsePageParam(bad), 1, String(bad));
  });

  it("paginates and clamps out-of-range pages", () => {
    const items = Array.from({ length: 25 }, (_, i) => i + 1);
    assert.deepEqual(paginate(items, 1, 12), { items: items.slice(0, 12), page: 1, pages: 3, total: 25 });
    assert.deepEqual(paginate(items, 3, 12).items, [25]);
    assert.equal(paginate(items, 99, 12).page, 3);
    assert.equal(paginate(items, 0, 12).page, 1);
    assert.equal(paginate(items, Number.NaN, 12).page, 1);
    assert.deepEqual(paginate([], 1, 12), { items: [], page: 1, pages: 1, total: 0 });
    assert.ok(LANDING_PAGE_SIZE > 0 && INSTRUCTORS_PAGE_SIZE > 0);
  });

  it("keeps defaults out of links so the first page is the bare canonical address", () => {
    assert.equal(landingHref("/courses/category/design"), "/courses/category/design");
    assert.equal(landingHref("/courses/category/design", { sort: "popular", page: 1 }), "/courses/category/design");
    assert.equal(landingHref("/courses/category/design", { sort: "newest" }), "/courses/category/design?sort=newest");
    assert.equal(landingHref("/courses/tag/figma", { sort: "rating", page: 2 }), "/courses/tag/figma?sort=rating&page=2");
    assert.equal(landingHref("/instructors", { q: "  design & ux ", page: 3 }), "/instructors?q=design+%26+ux&page=3");
    assert.equal(landingHref("/instructors", { q: "   " }), "/instructors");
  });

  it("only indexes topics shared by several courses", () => {
    assert.equal(isTagIndexable(TAG_MIN_COURSES_TO_INDEX), true);
    assert.equal(isTagIndexable(1), false);
    assert.equal(isTagIndexable(0), false);
  });
});

describe("category landing text", () => {
  it("normalises the introduction and snippet, clearing empty fields", () => {
    const { patch, errors } = parseCategorySeo({ intro: "  Line one\r\nLine two  ", seoTitle: "  Design   courses ", seoDescription: "" });
    assert.deepEqual(errors, {});
    assert.deepEqual(patch, { intro: "Line one\nLine two", seoTitle: "Design courses", seoDescription: undefined });
  });

  it("enforces the length limits", () => {
    const { errors } = parseCategorySeo({
      intro: "x".repeat(CATEGORY_SEO_LIMITS.intro + 1),
      seoTitle: "x".repeat(CATEGORY_SEO_LIMITS.seoTitle + 1),
      seoDescription: "x".repeat(CATEGORY_SEO_LIMITS.seoDescription + 1),
    });
    assert.deepEqual(Object.keys(errors).sort(), ["intro", "seoDescription", "seoTitle"]);
  });
});

describe("site footer rules", () => {
  it("shows the full footer on public sections only", () => {
    for (const path of ["/", "", "/courses", "/courses/ux-basics", "/courses/category/design", "/batches/spring", "/programs", "/jobs/designer", "/blog", "/blog/figma-tips", "/instructors/ada", "/user/ada", "/legal/privacy", "/sitemap", "/free", "/pricing"]) {
      assert.ok(hasFullFooter(path), path);
    }
    for (const path of ["/dashboard", "/admin", "/admin/courses", "/settings/profile", "/billing/course/1", "/notifications", "/quiz/1", "/coursesomething", "/you", "/leaderboard"]) {
      assert.ok(!hasFullFooter(path), path);
    }
  });

  it("labels official profiles by network, else by host", () => {
    assert.equal(socialLabel("https://www.linkedin.com/company/learnloop"), "LinkedIn");
    assert.equal(socialLabel("https://youtu.be/abc"), "YouTube");
    assert.equal(socialLabel("https://twitter.com/learnloop"), "X");
    assert.equal(socialLabel("https://x.com/learnloop"), "X");
    assert.equal(socialLabel("https://en.wikipedia.org/wiki/LearnLoop"), "Wikipedia");
    assert.equal(socialLabel("https://www.example.org/about"), "example.org");
    // Look-alike hosts are not mistaken for the network.
    assert.equal(socialLabel("https://notlinkedin.com/x"), "notlinkedin.com");
    assert.equal(socialLabel("javascript:alert(1)"), null);
    assert.equal(socialLabel("not a url"), null);
  });

  it("keeps only absolute links from a member's social profiles", () => {
    assert.deepEqual(socialUrls({ socials: { linkedin: "https://www.linkedin.com/in/ada", website: "ada.example", github: " " } }), ["https://www.linkedin.com/in/ada"]);
    assert.deepEqual(socialUrls({}), []);
  });
});

describe("resource hints", () => {
  const SITE = "https://learn.example.com";

  it("finds the origin of media on other hosts", () => {
    assert.equal(externalOrigin("https://cdn.example.net/a/b.png?x=1", SITE), "https://cdn.example.net");
    assert.equal(externalOrigin(`${SITE}/uploads/a.png`, SITE), null);
    assert.equal(externalOrigin("/uploads/a.png", SITE), null);
    assert.equal(externalOrigin("//cdn.example.net/a.png", SITE), null);
    assert.equal(externalOrigin("data:image/png;base64,AAAA", SITE), null);
    assert.equal(externalOrigin(undefined, SITE), null);
    assert.equal(externalOrigin("https://", SITE), null);
  });

  it("preconnects to the CDN and the busiest media host, and only resolves DNS for the rest", () => {
    const hints = resourceHints({
      siteOrigin: SITE,
      cdnBaseUrl: "https://cdn.example.net/media",
      mediaUrls: [
        "https://cdn.example.net/media/a.png",
        "https://img.one.example/a.png",
        "https://img.two.example/a.png",
        "https://img.two.example/b.png",
        "https://img.three.example/a.png",
        "/uploads/local.png",
        undefined,
        null,
        "",
      ],
    });
    assert.deepEqual(hints.preconnect, ["https://cdn.example.net", "https://img.two.example"]);
    assert.deepEqual(hints.dnsPrefetch, ["https://img.one.example", "https://img.three.example"]);
  });

  it("caps both lists and returns nothing for a self-hosted site", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://host${String(i).padStart(2, "0")}.example/a.png`);
    const hints = resourceHints({ siteOrigin: SITE, mediaUrls: many });
    assert.equal(hints.preconnect.length, MAX_PRECONNECT);
    assert.equal(hints.dnsPrefetch.length, MAX_DNS_PREFETCH);
    assert.equal(new Set([...hints.preconnect, ...hints.dnsPrefetch]).size, MAX_PRECONNECT + MAX_DNS_PREFETCH);
    assert.deepEqual(resourceHints({ siteOrigin: SITE, mediaUrls: ["/uploads/a.png", `${SITE}/uploads/b.png`] }), { preconnect: [], dnsPrefetch: [] });
  });
});

describe("landing page data", () => {
  beforeEach(async () => {
    await resetDb(fixture());
  });

  it("only ever returns published, released courses", async () => {
    assert.deepEqual(slugs(await getPublicCourseSummaries()), ["ux-basics", "figma-advanced", "javascript"]);
    assert.deepEqual(slugs(await getPublicCourseSummaries({ categoryId: "cat_dev" })), ["javascript"]);
    assert.deepEqual(slugs(await getPublicCourseSummaries({ categoryId: "cat_empty" })), []);
    assert.deepEqual(slugs(await getPublicCourseSummaries({ instructorId: "usr_bob", sort: "title" })), ["figma-advanced", "javascript"]);
  });

  it("lists categories that have public courses, largest first", async () => {
    const categories = await getCategoryDirectory();
    assert.deepEqual(
      categories.map((c) => [c.slug, c.courseCount]),
      [
        ["design", 2],
        ["development", 1],
      ],
    );
    assert.equal(categories[0]!.blurb, "Design courses for every level.");
    assert.deepEqual(categories[0]!.sampleCourses, ["UX basics", "Advanced Figma"]);
    assert.equal(categories[1]!.blurb, "");
  });

  it("builds a category landing page with courses, topics, instructors, articles and sibling categories", async () => {
    const landing = (await getCategoryLanding("design"))!;
    assert.equal(landing.category.name, "Design");
    assert.deepEqual(slugs(landing.courses), ["ux-basics", "figma-advanced"]);
    assert.equal(landing.learnerCount, 3);
    assert.deepEqual(
      landing.topics.map((t) => [t.slug, t.label, t.count]),
      [
        ["figma", "Figma", 2],
        ["prototyping", "Prototyping", 1],
        ["ux", "UX", 1],
      ],
    );
    assert.deepEqual(landing.instructors.map((i) => i.username), ["ada", "bob"]);
    assert.deepEqual(slugs(landing.posts), ["figma-tips"]);
    assert.deepEqual(
      landing.otherCategories.map((c) => [c.slug, c.courseCount]),
      [["development", 1]],
    );
  });

  it("sorts a category's courses on request and knows empty and unknown categories", async () => {
    assert.deepEqual(slugs((await getCategoryLanding("design", "rating"))!.courses), ["ux-basics", "figma-advanced"]);
    const empty = (await getCategoryLanding("marketing"))!;
    assert.deepEqual(empty.courses, []);
    assert.equal(empty.learnerCount, 0);
    assert.equal(await getCategoryLanding("nope"), null);
  });

  it("counts topics across public courses with their most common spelling", async () => {
    assert.deepEqual(
      (await getCourseTags()).map((t) => [t.slug, t.count]),
      [
        ["figma", 2],
        ["javascript", 1],
        ["prototyping", 1],
        ["ux", 1],
      ],
    );
  });

  it("builds a topic page with related topics, categories and articles", async () => {
    const landing = (await getTagLanding("figma"))!;
    assert.equal(landing.label, "Figma");
    assert.deepEqual(slugs(landing.courses), ["ux-basics", "figma-advanced"]);
    assert.deepEqual(slugs(landing.relatedTags).sort(), ["prototyping", "ux"]);
    assert.deepEqual(landing.categories, [{ id: "cat_design", name: "Design", slug: "design", courseCount: 2 }]);
    assert.deepEqual(slugs(landing.posts), ["figma-tips"]);
  });

  it("has no topic page for tags used only by drafts or scheduled courses", async () => {
    assert.equal(await getTagLanding("secret"), null);
    assert.equal(await getTagLanding("unknown"), null);
  });

  it("lists instructors who teach a public course, with their numbers", async () => {
    const directory = await getInstructorDirectory();
    assert.deepEqual(directory.map((i) => i.username), ["ada", "bob"]);
    const [ada, bob] = directory;
    assert.equal(ada!.courseCount, 2);
    assert.equal(ada!.learnerCount, 2);
    assert.equal(ada!.reviewCount, 2);
    assert.equal(ada!.averageRating, 4.5);
    assert.deepEqual(ada!.categories, ["Design"]);
    assert.equal(bob!.courseCount, 2);
    assert.equal(bob!.learnerCount, 1);
    assert.equal(bob!.averageRating, null);
    assert.deepEqual(bob!.categories.slice().sort(), ["Design", "Development"]);
  });

  it("searches instructors by name, headline, skill and subject", async () => {
    assert.deepEqual((await getInstructorDirectory("  RESEARCH ")).map((i) => i.username), ["ada"]);
    assert.deepEqual((await getInstructorDirectory("development")).map((i) => i.username), ["bob"]);
    assert.deepEqual((await getInstructorDirectory("stone")).map((i) => i.username), ["bob"]);
    assert.deepEqual(await getInstructorDirectory("nobody"), []);
  });

  it("hides ratings when reviews are switched off", async () => {
    await resetDb(fixture({ features: { reviews: false } }));
    const [ada] = await getInstructorDirectory();
    assert.equal(ada!.averageRating, null);
    assert.equal(ada!.reviewCount, 0);
  });

  it("builds a teaching profile with courses, articles, colleagues and Person markup", async () => {
    const profile = (await getInstructorProfile("ADA"))!;
    assert.equal(profile.instructor.name, "Ada Lovelace");
    assert.deepEqual(slugs(profile.courses), ["ux-basics", "figma-advanced"]);
    // A noindexed article is still public, so its author page may link to it.
    assert.deepEqual(slugs(profile.posts), ["figma-tips", "thin-post"]);
    assert.deepEqual(profile.colleagues.map((c) => c.username), ["bob"]);
    assert.equal(profile.jsonLd["@type"], "ProfilePage");
    const person = profile.jsonLd.mainEntity as Record<string, unknown>;
    assert.equal(person.name, "Ada Lovelace");
    assert.equal(person.jobTitle, "Design lead");
    assert.ok(String(person.url).endsWith("/instructors/ada"));
    // The member profile and absolute social links identify the same person; bare host names are dropped.
    assert.deepEqual(person.sameAs, ["https://www.linkedin.com/in/ada", "http://localhost:3000/user/ada"]);
    assert.deepEqual(person.knowsAbout, ["Figma", "Research", "Design"]);
  });

  it("has no teaching profile for learners, disabled accounts or people without a public course", async () => {
    assert.equal(await getInstructorProfile("eve"), null);
    assert.equal(await getInstructorProfile("zed"), null);
    assert.equal(await getInstructorProfile("nobody"), null);
  });

  it("recommends articles for a course: the ones that mention it, then its category", async () => {
    assert.deepEqual(slugs(await getCourseArticles({ id: "crs_ux", categoryId: "cat_design" })), ["figma-tips"]);
    assert.deepEqual(slugs(await getCourseArticles({ id: "crs_js", categoryId: "cat_dev" })), ["js-patterns"]);
    assert.deepEqual(await getCourseArticles({ id: "crs_js" }), []);
    await resetDb(fixture({ seo: { blogEnabled: false } }));
    assert.deepEqual(await getCourseArticles({ id: "crs_ux", categoryId: "cat_design" }), []);
  });
});

describe("site footer data", () => {
  it("links the main sections, categories, popular courses, articles and legal pages", async () => {
    await resetDb(fixture({ contact: { email: "hello@learnloop.test", url: "https://help.learnloop.test" }, seo: { sameAs: ["https://www.linkedin.com/company/learnloop"] } }));
    const footer = await getFooterData();
    assert.equal(footer.brandName, "LearnLoop");
    assert.equal(footer.tagline, "Learn by doing");
    assert.equal(footer.year, new Date().getFullYear());
    assert.equal(footer.contactEmail, "hello@learnloop.test");
    assert.equal(footer.contactUrl, "https://help.learnloop.test");
    assert.deepEqual(footer.sameAs, ["https://www.linkedin.com/company/learnloop"]);
    assert.deepEqual(footer.categories, [
      { name: "Design", href: "/courses/category/design", count: 2 },
      { name: "Development", href: "/courses/category/development", count: 1 },
    ]);
    assert.deepEqual(hrefs(footer.popularCourses), ["/courses/ux-basics", "/courses/figma-advanced", "/courses/javascript"]);
    assert.deepEqual(hrefs(footer.latestPosts), ["/blog/figma-tips", "/blog/js-patterns", "/blog/thin-post"]);
    assert.deepEqual(hrefs(footer.explore), ["/courses", "/batches", "/programs", "/instructors", "/blog", "/free", "/jobs", "/certified-members"]);
    assert.deepEqual(hrefs(footer.legal), ["/legal/privacy"]);
    assert.equal(footer.cookieBanner, true);
  });

  it("links nothing a guest cannot open on a members-only site", async () => {
    await resetDb(fixture({ learning: { allowGuestAccess: false }, legal: { cookieBanner: false } }));
    const footer = await getFooterData();
    assert.deepEqual(footer.categories, []);
    assert.deepEqual(footer.popularCourses, []);
    assert.deepEqual(hrefs(footer.explore), ["/blog", "/free", "/certified-members"]);
    assert.equal(footer.cookieBanner, false);
  });

  it("drops sections whose feature is off", async () => {
    await resetDb(fixture({ features: { batches: false, jobs: false, certifiedMembers: false }, seo: { blogEnabled: false } }));
    const footer = await getFooterData();
    assert.deepEqual(hrefs(footer.explore), ["/courses", "/programs", "/instructors", "/free"]);
    assert.deepEqual(footer.latestPosts, []);
  });
});

describe("HTML sitemap", () => {
  it("groups every public page by section", async () => {
    await resetDb(fixture());
    const sections = await getHtmlSitemap();
    assert.deepEqual(
      sections.map((s) => s.id),
      ["main-pages", "course-categories", "courses", "topics", "instructors", "batches", "programs", "articles", "jobs", "legal"],
    );
    const links = (id: string) => hrefs(sections.find((s) => s.id === id)!.links);
    assert.deepEqual(links("course-categories"), ["/courses/category/design", "/courses/category/development"]);
    // Alphabetical by title.
    assert.deepEqual(links("courses"), ["/courses/figma-advanced", "/courses/javascript", "/courses/ux-basics"]);
    assert.deepEqual(links("topics"), ["/courses/tag/figma", "/courses/tag/javascript", "/courses/tag/prototyping", "/courses/tag/ux"]);
    assert.deepEqual(links("instructors"), ["/instructors/ada", "/instructors/bob"]);
    assert.deepEqual(links("batches"), ["/batches/spring-cohort"]);
    assert.deepEqual(links("programs"), ["/programs/design-track"]);
    assert.deepEqual(links("articles"), ["/blog/figma-tips", "/blog/js-patterns"]);
    assert.deepEqual(links("jobs"), ["/jobs/product-designer"]);
    assert.deepEqual(links("legal"), ["/legal/privacy"]);
    assert.equal(sections.find((s) => s.id === "courses")!.href, "/courses");
    assert.equal(sections.find((s) => s.id === "course-categories")!.links[0]!.hint, "2");
  });

  it("never links drafts, private batches, closed jobs, noindexed posts or unpublished legal pages", async () => {
    await resetDb(fixture());
    const all = (await getHtmlSitemap()).flatMap((s) => hrefs(s.links));
    for (const hidden of ["/courses/draft-course", "/courses/scheduled-course", "/courses/tag/secret", "/courses/category/marketing", "/instructors/zed", "/instructors/eve", "/batches/private-cohort", "/programs/hidden-track", "/jobs/closed-role", "/blog/draft-post", "/blog/thin-post", "/legal/terms"]) {
      assert.ok(!all.includes(hidden), hidden);
    }
    assert.equal(new Set(all).size, all.length);
  });

  it("shrinks to the always-public pages on a members-only site", async () => {
    await resetDb(fixture({ learning: { allowGuestAccess: false } }));
    const sections = await getHtmlSitemap();
    assert.deepEqual(
      sections.map((s) => s.id),
      ["main-pages", "articles", "legal"],
    );
    assert.deepEqual(hrefs(sections[0]!.links), ["/", "/blog", "/certified-members", "/free"]);
  });
});

describe("catalog access", () => {
  it("lets guests in when the catalog is public", async () => {
    await resetDb(fixture());
    const { user, settings } = await requireCatalogAccess("/courses/category/design");
    assert.equal(user, null);
    assert.equal(catalogIsPublic(settings), true);
  });

  it("sends guests to sign in on a members-only site, keeping where they were going", async () => {
    await resetDb(fixture({ learning: { allowGuestAccess: false } }));
    await assert.rejects(requireCatalogAccess("/courses/tag/figma?sort=newest"), (err: { digest?: string }) => {
      assert.match(err.digest ?? "", /^NEXT_REDIRECT;/);
      assert.ok(err.digest!.includes(`/login?next=${encodeURIComponent("/courses/tag/figma?sort=newest")}`));
      return true;
    });
  });

  it("answers not found while courses are switched off", async () => {
    const db = await resetDb(fixture({ features: { courses: false } }));
    assert.equal(catalogIsPublic(db.settings), false);
    await assert.rejects(requireCatalogAccess("/instructors"), (err: { digest?: string }) => err.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("admin overview", () => {
  it("hints the CDN and the busiest cover host", async () => {
    await resetDb(fixture({ storage: { cdnBaseUrl: "https://cdn.example.net/media" } }));
    assert.deepEqual(await getResourceHints(), { preconnect: ["https://cdn.example.net", "https://img.example.net"], dnsPrefetch: [] });
  });

  it("summarises what search engines are told", async () => {
    await resetDb({ ...fixture(), slugRedirects: [{ id: "redir_1", fromPath: "/courses/old", toPath: "/courses/ux-basics", createdAt: "2026-01-03T00:00:00.000Z" }] });
    const overview = await getIndexingOverview();
    assert.equal(overview.origin, "http://localhost:3000");
    assert.equal(overview.reachable, false);
    assert.equal(overview.noindexSite, false);
    assert.equal(overview.sitemapFiles, 1);
    assert.equal(overview.redirectCount, 1);
    assert.equal(overview.indexNowKey, undefined);
    assert.deepEqual(overview.feeds.map((f) => f.url), ["http://localhost:3000/rss.xml", "http://localhost:3000/blog/rss.xml"]);
    assert.equal(overview.sitemap.sections.find((s) => s.key === "courses")?.count, 3);
    assert.ok(overview.sitemap.total > 10);
  });

  it("lists redirects with the state of their destination, newest first", async () => {
    await resetDb({
      ...fixture(),
      slugRedirects: [
        { id: "redir_1", fromPath: "/courses/old-ux", toPath: "/courses/ux-basics", createdAt: "2026-01-03T00:00:00.000Z" },
        { id: "redir_2", fromPath: "/courses/old-draft", toPath: "/courses/draft-course", createdAt: "2026-01-04T00:00:00.000Z" },
        { id: "redir_3", fromPath: "/courses/deleted", toPath: "/courses/gone", createdAt: "2026-01-05T00:00:00.000Z" },
        { id: "redir_4", fromPath: "/spring-sale", toPath: "/pricing", createdAt: "2026-01-06T00:00:00.000Z" },
      ],
    });
    const all = await listRedirects();
    assert.equal(all.total, 4);
    assert.equal(all.broken, 1);
    assert.deepEqual(
      all.rows.map((r) => [r.id, r.status]),
      [
        ["redir_4", "page"],
        ["redir_3", "missing"],
        ["redir_2", "hidden"],
        ["redir_1", "live"],
      ],
    );
    assert.deepEqual((await listRedirects({ filter: "broken" })).rows.map((r) => r.id), ["redir_3"]);
    assert.deepEqual((await listRedirects({ search: "UX" })).rows.map((r) => r.id), ["redir_1"]);
    const none = await listRedirects({ search: "nothing", filter: "broken" });
    assert.deepEqual(none.rows, []);
    assert.equal(none.total, 4);
  });
});
