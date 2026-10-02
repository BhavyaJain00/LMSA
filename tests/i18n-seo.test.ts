import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTENT_LANGUAGES, DEFAULT_OG_LOCALE, languageAlternates, openGraphLocale, pageMetadata, rootMetadata } from "@/lib/seo/metadata";
import { buildSettings } from "./helpers/db";

const ORIGIN = "https://learn.example.com";
type OG = { locale?: string; alternateLocale?: string[] };

describe("i18n SEO metadata", () => {
  it("og:locale follows the interface language when a page passes it", () => {
    assert.equal(openGraphLocale("ar"), "ar_AR");
    assert.equal(openGraphLocale("hi"), "hi_IN");
    assert.equal(openGraphLocale(undefined), DEFAULT_OG_LOCALE);
    assert.equal(openGraphLocale("xx"), DEFAULT_OG_LOCALE);
  });

  it("the root layout sets og:locale for the visitor's language", () => {
    const settings = buildSettings();
    assert.equal((rootMetadata(settings, ORIGIN, "fr").openGraph as OG).locale, "fr_FR");
    assert.equal((rootMetadata(settings, ORIGIN).openGraph as OG).locale, "en_US");
  });

  it("content pages describe their content language unless told otherwise", () => {
    const settings = buildSettings();
    const content = pageMetadata({ title: "JS", path: "/courses/js" }, settings, ORIGIN);
    assert.equal((content.openGraph as OG).locale, "en_US");
    const translatedPage = pageMetadata({ title: "Cours", path: "/courses", locale: "es" }, settings, ORIGIN);
    assert.equal((translatedPage.openGraph as OG).locale, "es_ES");
    assert.equal((translatedPage.openGraph as OG).alternateLocale, undefined, "one URL per page: no alternate locales");
  });

  it("hreflang lists the content language and x-default on the same URL", () => {
    assert.equal(CONTENT_LANGUAGES.length, 1);
    assert.deepEqual(languageAlternates("/blog/post?x=1", ORIGIN), { en: `${ORIGIN}/blog/post`, "x-default": `${ORIGIN}/blog/post` });
  });
});
