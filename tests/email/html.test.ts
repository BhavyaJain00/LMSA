import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  absoluteUrl,
  decodeEntities,
  escapeHtml,
  escapeMultiline,
  htmlToText,
  luminance,
  normalizeHexColor,
  readableTextColor,
  safeImageUrl,
  safeLinkUrl,
} from "@/lib/email/html";

const BASE = "https://lms.test/";

describe("escaping", () => {
  it("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(42), "42");
    assert.equal(escapeMultiline("a\r\nb<c>\rd"), "a<br>b&lt;c&gt;<br>d");
  });
});

describe("safeLinkUrl / safeImageUrl", () => {
  it("keeps absolute http(s) links (normalised)", () => {
    assert.equal(safeLinkUrl("HTTPS://Example.com/Path?q=1", BASE), "https://example.com/Path?q=1");
    assert.equal(safeLinkUrl("  http://example.com  ", BASE), "http://example.com/");
  });

  it("resolves app-relative paths against the base URL", () => {
    assert.equal(safeLinkUrl("/courses/intro?tab=1", BASE), "https://lms.test/courses/intro?tab=1");
    assert.equal(safeLinkUrl("/courses/intro", "https://lms.test///"), "https://lms.test/courses/intro");
  });

  it("keeps simple mailto links", () => {
    assert.equal(safeLinkUrl("mailto:ada@example.com", BASE), "mailto:ada@example.com");
    assert.equal(safeLinkUrl('mailto:ada@example.com"><script>', BASE), null);
  });

  it("rejects every other scheme, including obfuscated ones", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "\u0001javascript:alert(1)",
      " javascript:alert(1)",
      "jav\u0000ascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.com/file",
      "//evil.example.com",
      "/\\evil.example.com",
      "#top",
      "page.html",
      "",
      null,
      undefined,
    ]) {
      assert.equal(safeLinkUrl(bad, BASE), null, JSON.stringify(bad));
    }
  });

  it("allows only http(s) images", () => {
    assert.equal(safeImageUrl("https://cdn.example.com/a.png", BASE), "https://cdn.example.com/a.png");
    assert.equal(safeImageUrl("/uploads/a.png", BASE), "https://lms.test/uploads/a.png");
    assert.equal(safeImageUrl("mailto:ada@example.com", BASE), null);
    assert.equal(safeImageUrl("data:image/png;base64,AAAA", BASE), null);
  });

  it("makes paths absolute", () => {
    assert.equal(absoluteUrl("/courses", "https://lms.test/"), "https://lms.test/courses");
    assert.equal(absoluteUrl("courses", "https://lms.test"), "https://lms.test/courses");
    assert.equal(absoluteUrl("https://other.example.com/x", "https://lms.test"), "https://other.example.com/x");
  });
});

describe("colours", () => {
  it("normalises hex colours", () => {
    assert.equal(normalizeHexColor("#ABC"), "#aabbcc");
    assert.equal(normalizeHexColor(" #4F46E5 "), "#4f46e5");
    for (const bad of ["red", "#12345", "#abcdeg", "", null, undefined]) assert.equal(normalizeHexColor(bad), null, String(bad));
  });

  it("picks readable text colours by WCAG luminance", () => {
    assert.equal(luminance("#ffffff"), 1);
    assert.equal(luminance("#000000"), 0);
    assert.equal(readableTextColor("#4f46e5"), "#ffffff");
    assert.equal(readableTextColor("#fef08a"), "#111827");
    assert.equal(readableTextColor("#ffffff"), "#111827");
    assert.equal(readableTextColor("#000"), "#ffffff");
    assert.equal(readableTextColor("not a colour"), "#ffffff");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    assert.equal(decodeEntities("&lt;b&gt; &amp; &quot;x&quot; &apos;y&apos; &#39;z&#39; &#x1F680; &mdash; &copy; &nbsp;."), "<b> & \"x\" 'y' 'z' 🚀 — ©  .");
  });

  it("drops invalid code points and keeps unknown names", () => {
    assert.equal(decodeEntities("a&#xD800;b&#1114112;c&#847;d"), "abcd");
    assert.equal(decodeEntities("&unknown; &amp"), "&unknown; &amp");
  });
});

describe("htmlToText", () => {
  it("keeps structure and links, drops hidden content", () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body>
      <div data-preheader style="display:none">Preview text</div>
      <!-- comment -->
      <h1>Welcome,&nbsp;Ada</h1>
      <p>Your course <b>starts</b> soon.<br>See you there.</p>
      <p><a href="https://lms.test/courses/intro?a=1&amp;b=2">Open the course</a> or
         <a href="mailto:help@lms.test">help@lms.test</a> · <a href="#top">top</a></p>
      <ul><li>One</li><li>Two</li></ul>
      <img src="x.png" alt="Logo"><hr>
      <table><tr><td>A</td><td>B</td></tr></table>
      <script>alert(1)</script>
    </body></html>`;
    assert.equal(
      htmlToText(html),
      [
        "Welcome, Ada",
        "",
        "Your course starts soon.",
        "See you there.",
        "",
        "Open the course (https://lms.test/courses/intro?a=1&b=2) or help@lms.test · top",
        "",
        "- One",
        "- Two",
        "",
        "[Logo]",
        "----------------------------------------",
        "",
        "A B",
      ].join("\n"),
    );
  });
});
