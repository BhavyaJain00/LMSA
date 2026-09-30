import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Metadata } from "next";
import type { Settings } from "@/lib/types";
import { defaultSettings } from "@/lib/db/defaults";
import {
  CONTENT_LANGUAGES,
  NOINDEX,
  NOINDEX_FOLLOW,
  SITE_OG_IMAGE_PATH,
  languageAlternates,
  listingIndexing,
  notFoundMetadata,
  pageMetadata,
  robotsFor,
  rootMetadata,
} from "@/lib/seo/metadata";
import { absoluteUrl, canonicalUrl, isTrackingParam, normalizePath, siteOrigin, stripTrackingParams } from "@/lib/seo/site";
import { DESCRIPTION_MAX, applyTitleTemplate, clampText, explicitDescription, isoDuration, metaDescription, splitKeywords, suggestSlug } from "@/lib/seo/text";

/** Titles, descriptions, canonicals, Open Graph/Twitter, robots decisions and language alternates. */

const ORIGIN = "https://learn.example.com";

function settings(patch: (s: Settings) => void = () => {}): Settings {
  const s = defaultSettings();
  s.brand.name = "LearnLoop";
  patch(s);
  return s;
}

type OG = { url?: string; siteName?: string; locale?: string; type?: string; images?: { url: string; width?: number; height?: number }[] } & Record<string, unknown>;
type Tw = { card?: string; site?: string; images?: string[] };
const og = (m: Metadata) => m.openGraph as OG;
const tw = (m: Metadata) => m.twitter as Tw;

describe("canonical URLs", () => {
  it("normalises paths: leading slash, no trailing slash, no duplicate slashes, no query", () => {
    assert.equal(normalizePath("courses/"), "/courses");
    assert.equal(normalizePath("//courses//js/?a=1#x"), "/courses/js");
    assert.equal(normalizePath("/"), "/");
    assert.equal(normalizePath(""), "/");
  });

  it("builds absolute canonicals from the configured origin, keeping only meaningful sorted params", () => {
    assert.equal(canonicalUrl("/courses/js/", {}, ORIGIN), `${ORIGIN}/courses/js`);
    assert.equal(canonicalUrl("/", {}, ORIGIN), ORIGIN);
    assert.equal(canonicalUrl("/blog", { page: 2, utm_source: "x", q: "", b: "1" }, ORIGIN), `${ORIGIN}/blog?b=1&page=2`);
  });

  it("recognises and strips tracking parameters", () => {
    for (const name of ["utm_source", "utm_campaign", "gclid", "fbclid", "msclkid", "ref"]) assert.ok(isTrackingParam(name), name);
    assert.ok(!isTrackingParam("page"));
    const url = stripTrackingParams(new URL(`${ORIGIN}/courses?utm_source=x&page=2&fbclid=y`));
    assert.equal(url.search, "?page=2");
  });

  it("makes asset URLs absolute and refuses unsafe schemes", () => {
    assert.equal(absoluteUrl("/uploads/a.png", ORIGIN), `${ORIGIN}/uploads/a.png`);
    assert.equal(absoluteUrl("https://cdn.test/a.png", ORIGIN), "https://cdn.test/a.png");
    assert.equal(absoluteUrl("javascript:alert(1)", ORIGIN), undefined);
    assert.equal(absoluteUrl("//evil.test/a.png", ORIGIN), undefined);
    assert.equal(absoluteUrl("", ORIGIN), undefined);
  });

  it("falls back to localhost for a malformed APP_URL", () => {
    assert.equal(siteOrigin("not a url"), "http://localhost:3000");
    assert.equal(siteOrigin("https://learn.example.com/some/path/"), ORIGIN);
  });
});

describe("descriptions and titles", () => {
  it("composes a description from candidates, filling short ones and clamping at a word boundary", () => {
    const d = metaDescription("Short intro.", "Longer body text ".repeat(20));
    assert.ok(d.startsWith("Short intro. Longer body text"));
    assert.ok(d.length <= 155, `${d.length}`);
    assert.ok(d.endsWith("…"));
  });

  it("strips markdown and HTML from generated descriptions", () => {
    assert.equal(metaDescription("## Title\n\n**Bold** and [link](/x) <b>tag</b>"), "Title Bold and link tag");
  });

  it("uses an explicit description as written, only clamped", () => {
    assert.equal(explicitDescription("Exactly what the author wrote."), "Exactly what the author wrote.");
    assert.ok(explicitDescription("word ".repeat(80)).length <= DESCRIPTION_MAX);
  });

  it("clamps long text with an ellipsis", () => {
    assert.equal(clampText("one two three four", 100), "one two three four");
    assert.equal(clampText("one two three four five six", 14), "one two three…");
  });

  it("applies title templates", () => {
    assert.equal(applyTitleTemplate("%s · LearnLoop", "Courses"), "Courses · LearnLoop");
    assert.equal(applyTitleTemplate("| LearnLoop", "Courses"), "Courses | LearnLoop");
    assert.equal(applyTitleTemplate("", "Courses"), "Courses");
  });

  it("splits keywords and falls back to tags", () => {
    assert.deepEqual(splitKeywords("js, web\nreact, js"), ["js", "web", "react"]);
    assert.deepEqual(splitKeywords("", ["tag", " tag "]), ["tag"]);
    assert.deepEqual(splitKeywords(undefined), []);
  });

  it("formats ISO 8601 durations", () => {
    assert.equal(isoDuration(5400), "PT1H30M");
    assert.equal(isoDuration(45), "PT45S");
    assert.equal(isoDuration(0), undefined);
  });

  it("suggests clean slugs without stop words", () => {
    assert.equal(suggestSlug("The Complete Guide to JavaScript for Beginners"), "complete-guide-javascript-beginners");
    assert.equal(suggestSlug("How to Code"), "how-to-code");
  });
});

describe("robots decisions", () => {
  it("indexes public pages with rich snippet permissions", () => {
    const r = robotsFor(settings()) as { index: boolean; follow: boolean; googleBot: Record<string, unknown> };
    assert.equal(r.index, true);
    assert.equal(r.googleBot["max-image-preview"], "large");
  });

  it("noindexes drafts (nofollow) and list permutations (follow)", () => {
    assert.deepEqual(robotsFor(settings(), true), NOINDEX);
    assert.deepEqual(robotsFor(settings(), true, true), NOINDEX_FOLLOW);
  });

  it("noindexes everything when the site-wide switch is on", () => {
    assert.deepEqual(robotsFor(settings((s) => (s.seo.noindexSite = true))), NOINDEX);
  });

  it("treats search, sort, filters and later pages as permutations", () => {
    assert.equal(listingIndexing({}).noindex, false);
    assert.equal(listingIndexing({ page: 1, filters: [undefined, ""] }).noindex, false);
    assert.equal(listingIndexing({ search: "js" }).noindex, true);
    assert.equal(listingIndexing({ sort: "newest" }).noindex, true);
    assert.equal(listingIndexing({ filters: ["web"] }).noindex, true);
    assert.equal(listingIndexing({ page: 2 }).noindex, true);
    assert.equal(listingIndexing({ page: 2 }).follow, true);
  });
});

describe("pageMetadata", () => {
  it("builds title, description, canonical, Open Graph, Twitter and alternates for a public page", () => {
    const m = pageMetadata({ title: "JavaScript Fundamentals", description: "Learn JS by building projects.", path: "/courses/js/" }, settings((s) => (s.seo.twitterHandle = "@learnloop")), ORIGIN);
    assert.equal(m.title, "JavaScript Fundamentals");
    assert.equal(m.description, "Learn JS by building projects.");
    assert.equal(m.alternates?.canonical, `${ORIGIN}/courses/js`);
    assert.deepEqual(m.alternates?.languages, { en: `${ORIGIN}/courses/js`, "x-default": `${ORIGIN}/courses/js` });
    assert.equal((m.robots as { index: boolean }).index, true);

    const o = og(m);
    assert.equal(o.type, "website");
    assert.equal(o.url, `${ORIGIN}/courses/js`);
    assert.equal(o.siteName, "LearnLoop");
    assert.equal(o.locale, CONTENT_LANGUAGES[0]!.ogLocale);
    assert.equal(o.images?.[0]?.url, `${ORIGIN}${SITE_OG_IMAGE_PATH}`, "falls back to the generated site card");
    assert.equal(o.images?.[0]?.width, 1200);
    assert.equal(o.images?.[0]?.height, 630);

    const t = tw(m);
    assert.equal(t.card, "summary_large_image");
    assert.equal(t.site, "@learnloop");
    assert.deepEqual(t.images, [`${ORIGIN}${SITE_OG_IMAGE_PATH}`]);
  });

  it("leaves images out for routes with a generated opengraph-image", () => {
    const m = pageMetadata({ title: "Course", path: "/courses/x", generatedImage: true }, settings(), ORIGIN);
    assert.equal(og(m).images, undefined);
    assert.equal(tw(m).images, undefined);
  });

  it("uses an uploaded image as an absolute URL", () => {
    const m = pageMetadata({ title: "Course", path: "/courses/x", image: { url: "/uploads/og.png", alt: "Course" } }, settings(), ORIGIN);
    assert.equal(og(m).images?.[0]?.url, `${ORIGIN}/uploads/og.png`);
  });

  it("generates the description from candidates and falls back to the site default", () => {
    const m = pageMetadata({ title: "X", path: "/x", description: [undefined, "", "From the **body**."] }, settings(), ORIGIN);
    assert.equal(m.description, "From the body.");
    const fallback = pageMetadata({ title: "X", path: "/x", description: [] }, settings((s) => (s.seo.defaultDescription = "Site default.")), ORIGIN);
    assert.ok(String(fallback.description).startsWith("Site default."), String(fallback.description));
  });

  it("keeps canonical list URLs free of permutations and honours noindex/follow", () => {
    const m = pageMetadata({ title: "Search", path: "/courses", noindex: true, follow: true }, settings(), ORIGIN);
    assert.equal(m.alternates?.canonical, `${ORIGIN}/courses`);
    assert.deepEqual(m.robots, NOINDEX_FOLLOW);
  });

  it("supports an absolute title, a canonical override and article fields", () => {
    const m = pageMetadata(
      {
        title: "Post",
        absoluteTitle: true,
        path: "/blog/post",
        canonicalOverride: "https://medium.test/post",
        type: "article",
        article: { publishedTime: "2026-01-01", authors: ["Maya"], tags: ["js"] },
      },
      settings(),
      ORIGIN,
    );
    assert.deepEqual(m.title, { absolute: "Post" });
    assert.equal(m.alternates?.canonical, "https://medium.test/post");
    assert.equal(m.alternates?.languages, undefined, "no hreflang for pages canonicalised elsewhere");
    assert.equal(og(m).type, "article");
    assert.equal(og(m).publishedTime, "2026-01-01");
  });

  it("advertises the RSS feeds (blog only when enabled)", () => {
    const on = pageMetadata({ title: "X", path: "/" }, settings(), ORIGIN);
    const feeds = on.alternates?.types?.["application/rss+xml"] as { url: string }[];
    assert.deepEqual(feeds.map((f) => f.url), [`${ORIGIN}/rss.xml`, `${ORIGIN}/blog/rss.xml`]);
    const off = pageMetadata({ title: "X", path: "/" }, settings((s) => (s.seo.blogEnabled = false)), ORIGIN);
    assert.equal((off.alternates?.types?.["application/rss+xml"] as unknown[]).length, 1);
  });

  it("notFoundMetadata never indexes", () => {
    assert.deepEqual(notFoundMetadata().robots, NOINDEX);
  });
});

describe("rootMetadata", () => {
  it("defaults every page to noindex so private pages fail closed", () => {
    assert.deepEqual(rootMetadata(settings(), ORIGIN).robots, NOINDEX);
  });

  it("applies the title template and falls back when it lacks %s", () => {
    assert.deepEqual(rootMetadata(settings((s) => (s.seo.siteTitleTemplate = "%s | Academy")), ORIGIN).title, { default: "LearnLoop", template: "%s | Academy" });
    assert.deepEqual(rootMetadata(settings((s) => (s.seo.siteTitleTemplate = "Academy")), ORIGIN).title, { default: "LearnLoop", template: "%s · LearnLoop" });
  });

  it("emits Google and Bing verification tags", () => {
    const m = rootMetadata(
      settings((s) => {
        s.seo.googleVerification = "g-token";
        s.seo.bingVerification = "b-token";
      }),
      ORIGIN,
    );
    assert.equal(m.verification?.google, "g-token");
    assert.deepEqual(m.verification?.other, { "msvalidate.01": "b-token" });
    assert.equal(String(m.metadataBase), `${ORIGIN}/`);
  });

  it("only names a share image when one was uploaded (otherwise the generated card is used)", () => {
    assert.equal(og(rootMetadata(settings((s) => (s.brand.metaImageUrl = undefined)), ORIGIN)).images, undefined);
    const withImage = rootMetadata(settings((s) => (s.seo.defaultOgImageUrl = "/uploads/share.png")), ORIGIN);
    assert.equal(og(withImage).images?.[0]?.url, `${ORIGIN}/uploads/share.png`);
  });
});

describe("language alternates", () => {
  it("lists every content language plus x-default from one table", () => {
    const alt = languageAlternates("/courses", ORIGIN);
    assert.deepEqual(Object.keys(alt).sort(), [...CONTENT_LANGUAGES.map((l) => l.lang), "x-default"].sort());
    assert.equal(alt["x-default"], `${ORIGIN}/courses`);
  });
});
