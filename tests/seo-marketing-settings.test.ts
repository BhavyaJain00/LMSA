import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type SeoSettingsInput, extractVerificationToken, normalizeTwitterHandle, parseSameAs, parseSeoSettings } from "@/lib/seo/settings";

/** Admin → Settings → SEO form parsing: normalisation of pasted values and validation errors. */

function input(overrides: Partial<SeoSettingsInput> = {}): SeoSettingsInput {
  return {
    siteTitleTemplate: "%s · LearnLoop",
    metaDescription: "Hands-on courses.",
    metaKeywords: "js, web, js",
    metaImageUrl: "/uploads/share.png",
    twitterHandle: "@learnloop",
    organizationName: "LearnLoop Academy",
    organizationLogoUrl: "",
    sameAs: "https://www.linkedin.com/company/learnloop\nhttps://www.youtube.com/@learnloop",
    googleVerification: "",
    bingVerification: "",
    noindexSite: false,
    ...overrides,
  };
}

describe("normalizeTwitterHandle", () => {
  it("accepts handles with or without @ and profile URLs", () => {
    assert.equal(normalizeTwitterHandle("learnloop"), "@learnloop");
    assert.equal(normalizeTwitterHandle(" @learn_loop "), "@learn_loop");
    assert.equal(normalizeTwitterHandle("https://x.com/learnloop"), "@learnloop");
    assert.equal(normalizeTwitterHandle("twitter.com/learnloop?s=1"), "@learnloop");
  });

  it("returns an empty string for empty input and null for invalid handles", () => {
    assert.equal(normalizeTwitterHandle(""), "");
    assert.equal(normalizeTwitterHandle("not a handle"), null);
    assert.equal(normalizeTwitterHandle("@waytoolonghandle123"), null);
  });
});

describe("extractVerificationToken", () => {
  it("takes the content of a pasted meta tag", () => {
    assert.equal(extractVerificationToken('<meta name="google-site-verification" content="abcDEF_123-xyz" />'), "abcDEF_123-xyz");
    assert.equal(extractVerificationToken("<meta name='msvalidate.01' content='0123456789ABCDEF0123456789ABCDEF'>"), "0123456789ABCDEF0123456789ABCDEF");
  });

  it("accepts a bare token and rejects markup or spaces", () => {
    assert.equal(extractVerificationToken("  abcDEF_123-xyz  "), "abcDEF_123-xyz");
    assert.equal(extractVerificationToken(""), "");
    assert.equal(extractVerificationToken('"><script>alert(1)</script>'), null);
    assert.equal(extractVerificationToken("two words here"), null);
  });
});

describe("parseSameAs", () => {
  it("keeps unique absolute http(s) URLs and reports the rest", () => {
    const { urls, invalid } = parseSameAs("https://a.test/x\n\nhttps://a.test/x, http://b.test\njavascript:alert(1)\nnot-a-url");
    assert.deepEqual(urls, ["https://a.test/x", "http://b.test/"]);
    assert.deepEqual(invalid, ["javascript:alert(1)", "not-a-url"]);
  });
});

describe("parseSeoSettings", () => {
  it("normalises a valid form into brand and seo patches", () => {
    const { patch, errors } = parseSeoSettings(
      input({ googleVerification: '<meta name="google-site-verification" content="g-token-123" />', twitterHandle: "https://x.com/learnloop", noindexSite: true }),
    );
    assert.deepEqual(errors, {});
    assert.equal(patch.seo.siteTitleTemplate, "%s · LearnLoop");
    assert.equal(patch.seo.defaultDescription, "Hands-on courses.");
    assert.equal(patch.brand.metaDescription, "Hands-on courses.");
    assert.equal(patch.brand.metaKeywords, "js, web");
    assert.equal(patch.seo.defaultOgImageUrl, "/uploads/share.png");
    assert.equal(patch.brand.metaImageUrl, "/uploads/share.png");
    assert.equal(patch.seo.twitterHandle, "@learnloop");
    assert.equal(patch.seo.googleVerification, "g-token-123");
    assert.equal(patch.seo.bingVerification, undefined);
    assert.deepEqual(patch.seo.sameAs, ["https://www.linkedin.com/company/learnloop", "https://www.youtube.com/@learnloop"]);
    assert.equal(patch.seo.noindexSite, true);
  });

  it("requires %s in the title template and an organization name", () => {
    const { errors } = parseSeoSettings(input({ siteTitleTemplate: "LearnLoop", organizationName: " " }));
    assert.ok(errors.siteTitleTemplate);
    assert.ok(errors.organizationName);
  });

  it("rejects unsafe image URLs, bad handles, bad profile links and bad tokens", () => {
    const { errors } = parseSeoSettings(
      input({ metaImageUrl: "javascript:alert(1)", organizationLogoUrl: "//evil.test/x.png", twitterHandle: "no spaces allowed", sameAs: "ftp://x.test", bingVerification: "<b>bad</b>" }),
    );
    assert.deepEqual(Object.keys(errors).sort(), ["bingVerification", "metaImageUrl", "organizationLogoUrl", "sameAs", "twitterHandle"]);
  });

  it("limits the description length", () => {
    assert.ok(parseSeoSettings(input({ metaDescription: "x".repeat(301) })).errors.metaDescription);
  });
});
