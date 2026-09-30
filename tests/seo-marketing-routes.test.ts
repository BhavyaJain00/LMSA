import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET as blogFeedRoute } from "@/app/(app)/blog/rss.xml/route";
import { GET as indexNowKeyRoute } from "@/app/indexnow.txt/route";
import robots from "@/app/robots";
import { GET as courseFeedRoute } from "@/app/rss.xml/route";
import { GET as sitemapRoute } from "@/app/sitemap.xml/route";
import { GET as sitemapChunkRoute } from "@/app/sitemaps/[file]/route";
import { type Fixture, makeCourse, resetDb } from "./helpers/db";

/** The crawler-facing routes, read through the store: /sitemap.xml, /sitemaps/<n>.xml, /robots.txt, the feeds and the IndexNow key file. */

const ORIGIN = "http://localhost:3000";

function fixture(settings: Fixture["settings"] = {}): Fixture {
  return {
    settings,
    courses: [
      makeCourse({ id: "crs_pub", slug: "ux-basics", title: "UX <basics> & more", imageUrl: "/uploads/ux.png" }),
      makeCourse({ id: "crs_draft", slug: "draft-course", title: "Draft course", published: false }),
    ],
    blogPosts: [
      {
        id: "pst_1",
        slug: "figma-tips",
        title: "Ten Figma tips",
        excerpt: "Work faster in Figma.",
        content: "Body.",
        authorId: "usr_none",
        categoryIds: [],
        tags: [],
        status: "published",
        publishedAt: "2025-06-12T09:00:00.000Z",
        relatedCourseIds: [],
        readingTimeSeconds: 120,
        views: 0,
        createdAt: "2025-06-11T09:00:00.000Z",
        updatedAt: "2025-06-12T09:00:00.000Z",
      },
    ],
  };
}

const chunk = (file: string) => sitemapChunkRoute(new Request(`${ORIGIN}/sitemaps/${file}`), { params: Promise.resolve({ file }) });

describe("GET /sitemap.xml", () => {
  it("serves the public pages as XML", async () => {
    await resetDb(fixture());
    const res = await sitemapRoute();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
    const xml = await res.text();
    assert.ok(xml.includes(`<loc>${ORIGIN}/courses/ux-basics</loc>`));
    assert.ok(xml.includes(`<image:loc>${ORIGIN}/uploads/ux.png</image:loc>`));
    assert.ok(xml.includes(`<loc>${ORIGIN}/blog/figma-tips</loc>`));
    assert.ok(!xml.includes("draft-course"));
    assert.ok(!xml.includes("<sitemapindex"));
  });

  it("is an empty urlset while the site is hidden from search engines", async () => {
    await resetDb(fixture({ seo: { noindexSite: true } }));
    const xml = await (await sitemapRoute()).text();
    assert.ok(xml.includes("<urlset "));
    assert.ok(!xml.includes("<url>"));
  });

  it("serves numbered parts and rejects anything else", async () => {
    await resetDb(fixture());
    const first = await chunk("1.xml");
    assert.equal(first.status, 200);
    assert.ok((await first.text()).includes(`<loc>${ORIGIN}/courses/ux-basics</loc>`));
    for (const file of ["2.xml", "0.xml", "abc.xml", "1", "..%2F1.xml"]) assert.equal((await chunk(file)).status, 404, file);
  });
});

describe("GET /robots.txt", () => {
  it("points crawlers at the sitemap and keeps them out of private areas", async () => {
    await resetDb(fixture());
    const rules = await robots();
    assert.equal(rules.sitemap, `${ORIGIN}/sitemap.xml`);
    const list = Array.isArray(rules.rules) ? rules.rules : [rules.rules];
    assert.ok((list[0]!.disallow as string[]).includes("/admin"));
  });

  it("closes the whole site when it is hidden", async () => {
    await resetDb(fixture({ seo: { noindexSite: true } }));
    assert.deepEqual((await robots()).rules, { userAgent: "*", disallow: "/" });
  });
});

describe("RSS feeds", () => {
  it("serves new courses at /rss.xml with escaped titles", async () => {
    await resetDb(fixture());
    const res = await courseFeedRoute();
    assert.equal(res.headers.get("content-type"), "application/rss+xml; charset=utf-8");
    const xml = await res.text();
    assert.ok(xml.includes("<title>UX &lt;basics&gt; &amp; more</title>"));
    assert.ok(xml.includes(`<link>${ORIGIN}/courses/ux-basics</link>`));
    assert.ok(!xml.includes("Draft course"));
  });

  it("serves articles at /blog/rss.xml", async () => {
    await resetDb(fixture());
    const res = await blogFeedRoute();
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.ok(xml.includes("<title>Ten Figma tips</title>"));
    assert.ok(xml.includes(`<guid isPermaLink="true">${ORIGIN}/blog/figma-tips</guid>`));
  });

  it("answers not found for the blog feed while the blog is off", async () => {
    await resetDb(fixture({ seo: { blogEnabled: false } }));
    assert.equal((await blogFeedRoute()).status, 404);
  });
});

describe("GET /indexnow.txt", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  const get = (query = "") => indexNowKeyRoute(new Request(`${ORIGIN}/indexnow.txt${query}`));

  it("is not found until a key exists", async () => {
    await resetDb(fixture());
    assert.equal((await get()).status, 404);
  });

  it("serves the configured key as plain text", async () => {
    await resetDb(fixture({ seo: { indexNowKey: KEY } }));
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await res.text(), KEY);
  });

  it("answers the /<key>.txt form only for the configured key", async () => {
    await resetDb(fixture({ seo: { indexNowKey: KEY } }));
    assert.equal(await (await get(`?key=${KEY}`)).text(), KEY);
    const wrong = await get("?key=ffffffffffffffffffffffffffffffff");
    assert.equal(wrong.status, 404);
    assert.notEqual(await wrong.text(), KEY);
    assert.equal((await get("?key=")).status, 404);
  });
});
