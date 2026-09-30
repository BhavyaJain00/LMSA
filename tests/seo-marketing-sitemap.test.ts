import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BlogPost, Category, Database, JobOpening, LegalPage, Program, Settings } from "@/lib/types";
import { defaultSettings } from "@/lib/db/defaults";
import { DISALLOWED_PATHS, buildRobots } from "@/lib/seo/robots";
import { FEED_ITEM_LIMIT, blogFeed, courseFeed } from "@/lib/seo/feeds";
import { buildRss, escapeXml, rssResponse } from "@/lib/seo/rss";
import { SITEMAP_MAX_URLS, buildSitemap, publicCourses, summarizeSitemap } from "@/lib/seo/sitemap";
import {
  newestModified,
  parseSitemapChunk,
  renderSitemapIndex,
  renderUrlset,
  sitemapChunk,
  sitemapChunkCount,
  sitemapChunkPath,
  xmlResponse,
} from "@/lib/seo/sitemap-xml";
import { makeBatch, makeCourse, makeUser } from "./helpers/db";

/** sitemap.xml, robots.txt and the RSS feeds: only what an anonymous visitor may open is ever listed. */

const ORIGIN = "https://learn.example.com";
const NOW = Date.parse("2026-06-01T00:00:00.000Z");

type SiteDb = Pick<Database, "courses" | "batches" | "programs" | "jobs" | "blogPosts" | "categories" | "users" | "legalPages" | "settings">;

function post(overrides: Partial<BlogPost> & Pick<BlogPost, "id" | "slug">): BlogPost {
  return {
    title: `Post ${overrides.id}`,
    excerpt: "A short summary of the article.",
    content: "Body of the article.",
    authorId: "usr_ada",
    categoryIds: [],
    tags: [],
    status: "published",
    publishedAt: "2026-05-20T09:00:00.000Z",
    relatedCourseIds: [],
    readingTimeSeconds: 120,
    views: 0,
    createdAt: "2026-05-19T09:00:00.000Z",
    updatedAt: "2026-05-21T09:00:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<JobOpening> & Pick<JobOpening, "id" | "slug">): JobOpening {
  return {
    title: "Product designer",
    company: "Acme",
    location: "Berlin",
    remote: false,
    type: "full_time",
    description: "Design things.",
    postedById: "usr_ada",
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function program(overrides: Partial<Program> & Pick<Program, "id" | "slug">): Program {
  return {
    title: `Program ${overrides.id}`,
    published: true,
    enforceCourseOrder: false,
    courseIds: [],
    createdById: "usr_ada",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

function legal(overrides: Partial<LegalPage> & Pick<LegalPage, "slug">): LegalPage {
  return { id: `legal_${overrides.slug}`, title: overrides.slug, content: "Text", updatedAt: "2026-01-02T00:00:00.000Z", version: 1, published: true, ...overrides };
}

const CATEGORIES: Category[] = [
  { id: "cat_design", name: "Design", slug: "design" },
  { id: "cat_dev", name: "Development", slug: "development" },
  { id: "cat_empty", name: "Empty", slug: "empty" },
];

function site(patch: (s: Settings) => void = () => {}, overrides: Partial<SiteDb> = {}): SiteDb {
  const settings = defaultSettings();
  settings.brand.name = "LearnLoop";
  patch(settings);
  return {
    settings,
    categories: CATEGORIES,
    users: [
      makeUser({ id: "usr_ada", username: "ada", name: "Ada Lovelace", avatarUrl: "/uploads/ada.png", roles: ["course_creator"] }),
      makeUser({ id: "usr_bob", username: "bob", name: "Bob", enabled: false, roles: ["course_creator"] }),
      makeUser({ id: "usr_eve", username: "eve", name: "Eve" }),
    ],
    courses: [
      makeCourse({
        id: "crs_ux",
        slug: "ux-basics",
        title: "UX basics",
        shortIntroduction: "Learn the basics of UX research & design.",
        categoryId: "cat_design",
        tags: ["UX", "Figma"],
        instructorIds: ["usr_ada"],
        imageUrl: "/uploads/ux.png",
        videoUrl: "https://cdn.example.com/ux-promo.mp4",
        featured: true,
        publishedOn: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCourse({
        id: "crs_figma",
        slug: "figma-advanced",
        title: "Advanced Figma",
        categoryId: "cat_design",
        tags: ["figma"],
        instructorIds: ["usr_ada", "usr_bob"],
        videoUrl: "/uploads/videos/figma-promo.mp4",
        publishedOn: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      }),
      makeCourse({ id: "crs_draft", slug: "draft-course", published: false, categoryId: "cat_dev", tags: ["Secret"], instructorIds: ["usr_eve"] }),
      makeCourse({ id: "crs_later", slug: "scheduled-course", publishAt: "2026-07-01T00:00:00.000Z", categoryId: "cat_dev", tags: ["Secret"], instructorIds: ["usr_eve"] }),
    ],
    batches: [
      makeBatch({ id: "bat_open", slug: "spring-cohort", startDate: "2026-06-10", endDate: "2026-07-10", imageUrl: "/uploads/cohort.png" }),
      makeBatch({ id: "bat_done", slug: "winter-cohort", startDate: "2026-01-10", endDate: "2026-02-10" }),
      makeBatch({ id: "bat_private", slug: "private-cohort", published: false }),
    ],
    programs: [program({ id: "prg_pub", slug: "design-track" }), program({ id: "prg_draft", slug: "hidden-track", published: false })],
    jobs: [job({ id: "job_open", slug: "product-designer" }), job({ id: "job_closed", slug: "old-role", status: "closed" })],
    blogPosts: [
      post({ id: "pst_live", slug: "ux-checklist", categoryIds: ["cat_design"], tags: ["UX Research"], coverImageUrl: "/uploads/checklist.png" }),
      post({ id: "pst_old", slug: "old-news", publishedAt: "2026-01-05T09:00:00.000Z", createdAt: "2026-01-05T09:00:00.000Z" }),
      post({ id: "pst_draft", slug: "draft-post", status: "draft", publishedAt: undefined }),
      post({ id: "pst_future", slug: "future-post", status: "scheduled", publishedAt: "2026-06-15T09:00:00.000Z" }),
      post({ id: "pst_due", slug: "due-post", status: "scheduled", publishedAt: "2026-05-30T09:00:00.000Z" }),
      post({ id: "pst_noindex", slug: "thin-post", noindex: true }),
      post({ id: "pst_syndicated", slug: "syndicated", canonicalUrl: "https://elsewhere.example.org/original" }),
      post({ id: "pst_self", slug: "self-canonical", canonicalUrl: `${ORIGIN}/blog/self-canonical` }),
    ],
    legalPages: [legal({ slug: "privacy" }), legal({ slug: "terms", published: false })],
    ...overrides,
  };
}

const paths = (db: SiteDb) => buildSitemap(db, ORIGIN, NOW).map((e) => (e.url === ORIGIN ? "/" : e.url.slice(ORIGIN.length)));

describe("buildSitemap", () => {
  it("lists the home page, sections, landing pages and every public item", () => {
    assert.deepEqual(paths(site()).sort(), [
      "/",
      "/batches",
      "/batches/spring-cohort",
      "/batches/winter-cohort",
      "/blog",
      "/blog/category/design",
      "/blog/due-post",
      "/blog/old-news",
      "/blog/self-canonical",
      "/blog/tag/ux-research",
      "/blog/ux-checklist",
      "/courses",
      "/courses/category",
      "/courses/category/design",
      "/courses/figma-advanced",
      "/courses/tag",
      "/courses/tag/figma",
      "/courses/ux-basics",
      "/free",
      "/instructors",
      "/instructors/ada",
      "/jobs",
      "/jobs/product-designer",
      "/legal/privacy",
      "/programs",
      "/programs/design-track",
      "/sitemap",
    ]);
  });

  it("never lists drafts, scheduled items, private batches, closed jobs, noindexed or syndicated posts", () => {
    const listed = paths(site());
    for (const hidden of [
      "/courses/draft-course",
      "/courses/scheduled-course",
      "/courses/category/development",
      "/courses/category/empty",
      "/courses/tag/secret",
      "/instructors/eve",
      "/instructors/bob",
      "/batches/private-cohort",
      "/programs/hidden-track",
      "/jobs/old-role",
      "/blog/draft-post",
      "/blog/future-post",
      "/blog/thin-post",
      "/blog/syndicated",
      "/legal/terms",
    ]) {
      assert.ok(!listed.includes(hidden), hidden);
    }
    // A topic with a single course repeats that course's page, so it stays out.
    assert.ok(!listed.includes("/courses/tag/ux"));
  });

  it("publishes a scheduled course once its time has come", () => {
    const later = Date.parse("2026-07-02T00:00:00.000Z");
    const listed = buildSitemap(site(), ORIGIN, later).map((e) => e.url);
    assert.ok(listed.includes(`${ORIGIN}/courses/scheduled-course`));
    assert.ok(listed.includes(`${ORIGIN}/courses/category/development`));
  });

  it("is empty when the whole site is set to noindex", () => {
    assert.deepEqual(buildSitemap(site((s) => (s.seo.noindexSite = true)), ORIGIN, NOW), []);
  });

  it("leaves out catalog sections guests cannot open", () => {
    const listed = paths(site((s) => (s.learning.allowGuestAccess = false)));
    assert.ok(!listed.some((p) => p.startsWith("/courses") || p.startsWith("/batches") || p.startsWith("/programs") || p.startsWith("/jobs") || p.startsWith("/instructors")));
    // The blog and legal pages are always public.
    assert.ok(listed.includes("/blog/ux-checklist"));
    assert.ok(listed.includes("/legal/privacy"));
  });

  it("drops a section when its feature is switched off", () => {
    const listed = paths(
      site((s) => {
        s.features.batches = false;
        s.features.jobs = false;
        s.seo.blogEnabled = false;
      }),
    );
    assert.ok(!listed.some((p) => p.startsWith("/batches") || p.startsWith("/jobs") || p.startsWith("/blog")));
    assert.ok(listed.includes("/courses/ux-basics"));
  });

  it("sets lastModified, change frequency and priority", () => {
    const entries = buildSitemap(site(), ORIGIN, NOW);
    const find = (path: string) => entries.find((e) => e.url === `${ORIGIN}${path}`)!;
    const home = entries.find((e) => e.url === ORIGIN)!;
    assert.equal(home.priority, 1);
    assert.equal(home.changeFrequency, "daily");
    assert.equal(home.lastModified, "2026-05-10T00:00:00.000Z");
    assert.equal(find("/courses/ux-basics").priority, 0.9);
    assert.equal(find("/courses/figma-advanced").priority, 0.8);
    assert.equal(find("/courses/figma-advanced").lastModified, "2026-05-10T00:00:00.000Z");
    assert.equal(find("/courses/category/design").lastModified, "2026-05-10T00:00:00.000Z");
    // Finished batches are rarely worth recrawling.
    assert.equal(find("/batches/winter-cohort").changeFrequency, "yearly");
    assert.equal(find("/batches/spring-cohort").changeFrequency, "weekly");
    assert.equal(find("/blog/ux-checklist").changeFrequency, "weekly");
    assert.equal(find("/blog/old-news").changeFrequency, "monthly");
    for (const e of entries) assert.ok(e.priority !== undefined && e.priority > 0 && e.priority <= 1, e.url);
  });

  it("lists covers as images and only public preview videos", () => {
    const entries = buildSitemap(site(), ORIGIN, NOW);
    const ux = entries.find((e) => e.url.endsWith("/courses/ux-basics"))!;
    assert.deepEqual(ux.images, [`${ORIGIN}/uploads/ux.png`]);
    assert.equal(ux.videos?.length, 1);
    assert.equal(ux.videos![0]!.content_loc, "https://cdn.example.com/ux-promo.mp4");
    assert.equal(ux.videos![0]!.thumbnail_loc, `${ORIGIN}/uploads/ux.png`);
    assert.equal(ux.videos![0]!.title, "UX basics");
    // Protected uploads need a signed token: they are never advertised.
    const figma = entries.find((e) => e.url.endsWith("/courses/figma-advanced"))!;
    assert.equal(figma.videos, undefined);
    assert.equal(figma.images, undefined);
    assert.deepEqual(entries.find((e) => e.url.endsWith("/instructors/ada"))!.images, [`${ORIGIN}/uploads/ada.png`]);
    assert.deepEqual(entries.find((e) => e.url.endsWith("/blog/ux-checklist"))!.images, [`${ORIGIN}/uploads/checklist.png`]);
  });

  it("only emits absolute URLs on the canonical origin, each once", () => {
    const urls = buildSitemap(site(), ORIGIN, NOW).map((e) => e.url);
    assert.equal(new Set(urls).size, urls.length);
    for (const url of urls) assert.ok(url === ORIGIN || url.startsWith(`${ORIGIN}/`), url);
  });
});

describe("publicCourses", () => {
  it("returns published, released courses newest first", () => {
    assert.deepEqual(
      publicCourses(site(), NOW).map((c) => c.slug),
      ["figma-advanced", "ux-basics"],
    );
  });

  it("is empty when guests cannot browse or courses are off", () => {
    assert.deepEqual(publicCourses(site((s) => (s.learning.allowGuestAccess = false)), NOW), []);
    assert.deepEqual(publicCourses(site((s) => (s.features.courses = false)), NOW), []);
  });
});

describe("summarizeSitemap", () => {
  it("counts addresses per section, images and videos", () => {
    const summary = summarizeSitemap(buildSitemap(site(), ORIGIN, NOW), ORIGIN);
    const count = (key: string) => summary.sections.find((s) => s.key === key)?.count ?? 0;
    assert.equal(summary.total, 27);
    assert.equal(count("courses"), 2);
    assert.equal(count("categories"), 2);
    assert.equal(count("tags"), 2);
    assert.equal(count("instructors"), 1);
    assert.equal(count("batches"), 2);
    assert.equal(count("blog"), 6);
    assert.equal(count("legal"), 1);
    // Home, section indexes, /free and /sitemap.
    assert.equal(count("pages"), 9);
    assert.equal(summary.sections.reduce((sum, s) => sum + s.count, 0), summary.total);
    assert.equal(summary.videos, 1);
    assert.equal(summary.images, 4);
  });

  it("hides empty sections", () => {
    assert.deepEqual(summarizeSitemap([], ORIGIN), { total: 0, images: 0, videos: 0, sections: [] });
  });
});

describe("sitemap XML", () => {
  it("renders a urlset with image and video extensions", () => {
    const xml = renderUrlset(buildSitemap(site(), ORIGIN, NOW));
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset '));
    assert.ok(xml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'));
    assert.ok(xml.includes('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'));
    assert.ok(xml.includes(`<loc>${ORIGIN}/courses/ux-basics</loc>`));
    assert.ok(xml.includes("<lastmod>2026-05-01T00:00:00.000Z</lastmod>"));
    assert.ok(xml.includes("<changefreq>weekly</changefreq>"));
    assert.ok(xml.includes("<priority>0.9</priority>"));
    assert.ok(xml.includes(`<image:loc>${ORIGIN}/uploads/ux.png</image:loc>`));
    assert.ok(xml.includes("<video:content_loc>https://cdn.example.com/ux-promo.mp4</video:content_loc>"));
    assert.ok(xml.includes("<video:description>Learn the basics of UX research &amp; design.</video:description>"));
    assert.ok(xml.trimEnd().endsWith("</urlset>"));
  });

  it("escapes URLs and text so content can never break the document", () => {
    const xml = renderUrlset([
      {
        url: `${ORIGIN}/courses/a?x=1&y=<2>`,
        lastModified: "not a date",
        videos: [{ title: 'Tom & "Jerry"', description: "<script>", thumbnail_loc: `${ORIGIN}/t.png`, content_loc: `${ORIGIN}/v.mp4`, duration: 99_999 }],
      },
    ]);
    assert.ok(xml.includes(`<loc>${ORIGIN}/courses/a?x=1&amp;y=&lt;2&gt;</loc>`));
    assert.ok(xml.includes("<video:title>Tom &amp; &quot;Jerry&quot;</video:title>"));
    assert.ok(xml.includes("<video:description>&lt;script&gt;</video:description>"));
    // Invalid dates are left out; durations are capped at Google's 8 hour limit.
    assert.ok(!xml.includes("<lastmod>"));
    assert.ok(xml.includes("<video:duration>28800</video:duration>"));
  });

  it("emits hreflang alternates when an entry has them", () => {
    const xml = renderUrlset([{ url: `${ORIGIN}/courses`, alternates: { languages: { en: `${ORIGIN}/courses`, fr: `${ORIGIN}/fr/courses` } } }]);
    assert.ok(xml.includes(`<xhtml:link rel="alternate" hreflang="fr" href="${ORIGIN}/fr/courses" />`));
  });

  it("splits large sitemaps into numbered files behind an index", () => {
    assert.equal(SITEMAP_MAX_URLS, 50_000);
    assert.equal(sitemapChunkCount(0), 1);
    assert.equal(sitemapChunkCount(50_000), 1);
    assert.equal(sitemapChunkCount(50_001), 2);
    const entries = Array.from({ length: 5 }, (_, i) => ({ url: `${ORIGIN}/p/${i}`, lastModified: `2026-01-0${i + 1}T00:00:00.000Z` }));
    assert.equal(sitemapChunkCount(entries.length, 2), 3);
    assert.deepEqual(
      sitemapChunk(entries, 2, 2).map((e) => e.url),
      [`${ORIGIN}/p/2`, `${ORIGIN}/p/3`],
    );
    assert.deepEqual(sitemapChunk(entries, 4, 2), []);
    assert.equal(newestModified(sitemapChunk(entries, 3, 2)), "2026-01-05T00:00:00.000Z");
    assert.equal(newestModified([{ url: ORIGIN }]), undefined);
    assert.equal(sitemapChunkPath(3), "/sitemaps/3.xml");
    const index = renderSitemapIndex([{ url: `${ORIGIN}/sitemaps/1.xml`, lastModified: "2026-01-02T00:00:00.000Z" }, { url: `${ORIGIN}/sitemaps/2.xml` }]);
    assert.ok(index.includes("<sitemapindex "));
    assert.ok(index.includes(`<loc>${ORIGIN}/sitemaps/2.xml</loc>`));
    assert.equal(index.match(/<lastmod>/g)?.length, 1);
  });

  it("only accepts well-formed chunk file names", () => {
    assert.equal(parseSitemapChunk("1.xml"), 1);
    assert.equal(parseSitemapChunk("42.xml"), 42);
    for (const bad of ["0.xml", "01.xml", "-1.xml", "1", "1.xml.gz", "a.xml", "../1.xml", "1234567.xml", ""]) assert.equal(parseSitemapChunk(bad), null, bad);
  });

  it("is served as XML that is itself kept out of search results", () => {
    const res = xmlResponse("<urlset/>");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.ok(res.headers.get("cache-control")?.includes("max-age="));
  });
});

describe("robots.txt", () => {
  it("opens public content, names the sitemap and blocks private areas", () => {
    const robots = buildRobots(site().settings, ORIGIN);
    assert.equal(robots.sitemap, `${ORIGIN}/sitemap.xml`);
    assert.equal(robots.host, ORIGIN);
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.userAgent, "*");
    assert.equal(rules[0]!.allow, "/");
    const disallow = rules[0]!.disallow as string[];
    for (const path of ["/admin", "/api/", "/dashboard", "/settings", "/billing", "/notifications", "/login", "/offline", "/*/learn/"]) assert.ok(disallow.includes(path), path);
  });

  it("never blocks public sections, generated share images, the sitemap or the feeds", () => {
    // robots.txt matching: a rule is a path prefix and "*" stands for any run of characters.
    const literal = (part: string) => part.replace(/[.+?^$()|[\]{}\\]/g, "\\$&");
    const blocked = (path: string) => DISALLOWED_PATHS.some((rule) => new RegExp("^" + rule.split("*").map(literal).join(".*")).test(path));
    for (const open of [
      "/",
      "/courses",
      "/courses/ux-basics",
      "/courses/ux-basics/opengraph-image",
      "/courses/category/design",
      "/courses/tag/figma",
      "/instructors/ada",
      "/batches/spring-cohort",
      "/programs/design-track",
      "/jobs/product-designer",
      "/blog/ux-checklist",
      "/blog/rss.xml",
      "/rss.xml",
      "/sitemap.xml",
      "/sitemaps/1.xml",
      "/sitemap",
      "/opengraph-image",
      "/legal/privacy",
      "/free",
      "/uploads/ux.png",
    ]) {
      assert.ok(!blocked(open), open);
    }
    for (const closed of ["/admin/courses", "/api/upload", "/dashboard", "/settings/profile", "/billing/course/1", "/courses/ux-basics/learn/1-1", "/courses?search=figma", "/courses?page=2&sort=newest", "/free/confirm"]) {
      assert.ok(blocked(closed), closed);
    }
  });

  it("blocks every crawler while the site is hidden", () => {
    const robots = buildRobots(site((s) => (s.seo.noindexSite = true)).settings, ORIGIN);
    assert.deepEqual(robots.rules, { userAgent: "*", disallow: "/" });
    assert.equal(robots.sitemap, undefined);
  });
});

describe("RSS feeds", () => {
  it("lists new public courses, newest first, with author, categories and cover", () => {
    const feed = courseFeed(site(), ORIGIN, NOW);
    assert.equal(feed.title, "New courses · LearnLoop");
    assert.equal(feed.link, `${ORIGIN}/courses`);
    assert.equal(feed.feedUrl, `${ORIGIN}/rss.xml`);
    assert.deepEqual(
      feed.items.map((i) => i.link),
      [`${ORIGIN}/courses/figma-advanced`, `${ORIGIN}/courses/ux-basics`],
    );
    const ux = feed.items[1]!;
    assert.equal(ux.author, "Ada Lovelace");
    assert.deepEqual(ux.categories, ["Design", "UX", "Figma"]);
    assert.equal(ux.image, `${ORIGIN}/uploads/ux.png`);
    assert.equal(ux.pubDate, "2026-04-01T00:00:00.000Z");
    assert.ok(ux.description.startsWith("Learn the basics of UX research & design."));
  });

  it("lists public, indexable blog posts only", () => {
    const feed = blogFeed(site(), ORIGIN, NOW);
    assert.equal(feed.feedUrl, `${ORIGIN}/blog/rss.xml`);
    const links = feed.items.map((i) => i.link.slice(ORIGIN.length));
    assert.deepEqual(links.slice().sort(), ["/blog/due-post", "/blog/old-news", "/blog/self-canonical", "/blog/syndicated", "/blog/ux-checklist"]);
    assert.ok(!links.includes("/blog/draft-post"));
    assert.ok(!links.includes("/blog/future-post"));
    assert.ok(!links.includes("/blog/thin-post"));
    // Newest first.
    assert.equal(links[0], "/blog/due-post");
    assert.equal(links.at(-1), "/blog/old-news");
    assert.deepEqual(feed.items.find((i) => i.link.endsWith("/blog/ux-checklist"))!.categories, ["Design", "UX Research"]);
  });

  it("is empty while the site is hidden or the blog is off", () => {
    assert.deepEqual(courseFeed(site((s) => (s.seo.noindexSite = true)), ORIGIN, NOW).items, []);
    assert.deepEqual(blogFeed(site((s) => (s.seo.noindexSite = true)), ORIGIN, NOW).items, []);
    assert.deepEqual(blogFeed(site((s) => (s.seo.blogEnabled = false)), ORIGIN, NOW).items, []);
    assert.deepEqual(courseFeed(site((s) => (s.learning.allowGuestAccess = false)), ORIGIN, NOW).items, []);
  });

  it("keeps only the most recent items", () => {
    const many = Array.from({ length: FEED_ITEM_LIMIT + 5 }, (_, i) =>
      makeCourse({ id: `crs_many_${i}`, slug: `course-${i}`, publishedOn: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }),
    );
    const feed = courseFeed(site(undefined, { courses: many }), ORIGIN, NOW);
    assert.equal(feed.items.length, FEED_ITEM_LIMIT);
    assert.equal(feed.items[0]!.link, `${ORIGIN}/courses/course-${FEED_ITEM_LIMIT + 4}`);
  });

  it("renders valid RSS 2.0 and escapes user content", () => {
    const xml = buildRss({
      title: "Blog · Tom & Jerry",
      link: `${ORIGIN}/blog`,
      feedUrl: `${ORIGIN}/blog/rss.xml`,
      description: "Articles <b>and</b> news",
      items: [
        {
          title: 'Why "x < y" matters',
          link: `${ORIGIN}/blog/a?b=1&c=2`,
          description: "Body with ]]> and \u0007 a control character",
          pubDate: "2026-05-20T09:00:00.000Z",
          author: "Ada & Co",
          categories: ["R&D"],
          image: `${ORIGIN}/uploads/cover.webp`,
        },
        { title: "Undated", link: `${ORIGIN}/blog/undated`, description: "x", pubDate: "nonsense" },
      ],
    });
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'));
    assert.ok(xml.includes("<title>Blog · Tom &amp; Jerry</title>"));
    assert.ok(xml.includes("<description>Articles &lt;b&gt;and&lt;/b&gt; news</description>"));
    assert.ok(xml.includes(`<atom:link href="${ORIGIN}/blog/rss.xml" rel="self" type="application/rss+xml" />`));
    assert.ok(xml.includes("<title>Why &quot;x &lt; y&quot; matters</title>"));
    assert.ok(xml.includes(`<link>${ORIGIN}/blog/a?b=1&amp;c=2</link>`));
    assert.ok(xml.includes(`<guid isPermaLink="true">${ORIGIN}/blog/a?b=1&amp;c=2</guid>`));
    assert.ok(xml.includes("<pubDate>Wed, 20 May 2026 09:00:00 GMT</pubDate>"));
    assert.ok(xml.includes("<dc:creator>Ada &amp; Co</dc:creator>"));
    assert.ok(xml.includes("<category>R&amp;D</category>"));
    assert.ok(xml.includes("Body with ]]&gt; and  a control character"));
    assert.ok(xml.includes(`<enclosure url="${ORIGIN}/uploads/cover.webp" length="0" type="image/webp" />`));
    // A malformed date falls back to the epoch instead of "Invalid Date".
    assert.ok(!xml.includes("Invalid Date"));
    assert.ok(xml.endsWith("</rss>\n"));
    assert.ok(!xml.includes("\n\n"));
  });

  it("escapes the five XML entities and strips characters XML forbids", () => {
    assert.equal(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;");
    assert.equal(escapeXml("a\u0000b\u000bc\td\ne"), "abc\td\ne");
  });

  it("is served with the RSS content type", () => {
    assert.equal(rssResponse("<rss/>").headers.get("content-type"), "application/rss+xml; charset=utf-8");
  });
});
