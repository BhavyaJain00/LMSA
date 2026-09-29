import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeMarkdown, markdownToEmailHtml, markdownToText } from "@/lib/email/markdown";

const BASE = "https://lms.test";
const html = (md: string) => markdownToEmailHtml(md, { baseUrl: BASE });
const text = (md: string) => markdownToText(md, { baseUrl: BASE });
/** All href/src attribute values in rendered HTML. */
const urls = (out: string) => [...out.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);

describe("markdownToEmailHtml: safety", () => {
  it("escapes raw HTML instead of passing it through", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)"> & <b>bold</b>');
    assert.ok(!/<script|<img|<b>/i.test(out), out);
    assert.ok(out.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;bold&lt;/b&gt;"));
  });

  it("drops dangerous link schemes but keeps the link text", () => {
    for (const dest of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(document.cookie)",
      " javascript:alert(1)",
      "javascript&#58;alert(1)",
      "&#106;avascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example.com/phish",
      "#fragment",
      "relative/page.html",
    ]) {
      const out = html(`[click me](<${dest}>)`);
      assert.ok(!out.includes("<a "), `${dest} → ${out}`);
      assert.ok(out.includes("click me"), dest);
      assert.ok(!/javascript:|vbscript:|data:/i.test(out.replace(/&#58;|&amp;#58;/g, "")), dest);
    }
  });

  it("does not let a URL break out of its attribute", () => {
    const out = html('[x](https://ok.example.com/a"onmouseover="alert(1))');
    assert.ok(!out.includes('"onmouseover'), out);
    for (const u of urls(out)) assert.ok(!u.includes('"'));
  });

  it("allows http(s), mailto and app-relative links", () => {
    const out = html("[site](https://example.com/?a=1&b=2) [mail](mailto:ada@example.com) [course](/courses/intro) [t](https://example.com \"Title <b>\")");
    assert.deepEqual(urls(out), ["https://example.com/?a=1&amp;b=2", "mailto:ada@example.com", "https://lms.test/courses/intro", "https://example.com/"]);
    assert.ok(out.includes('target="_blank" rel="noopener noreferrer"'));
    assert.ok(out.includes('title="Title &lt;b&gt;"'));
  });

  it("only renders http(s) and app-relative images", () => {
    assert.deepEqual(urls(html("![Logo <x>](https://cdn.example.com/logo.png)")), ["https://cdn.example.com/logo.png"]);
    assert.ok(html("![Logo <x>](https://cdn.example.com/logo.png)").includes('alt="Logo &lt;x&gt;"'));
    assert.deepEqual(urls(html("![a](/uploads/a.png)")), ["https://lms.test/uploads/a.png"]);
    for (const src of ["javascript:alert(1)", "data:image/png;base64,AAAA", "mailto:a@b.co"]) {
      const out = html(`![fallback text](${src})`);
      assert.ok(!out.includes("<img"), src);
      assert.ok(out.includes("fallback text"), src);
    }
  });

  it("escapes code spans and code blocks", () => {
    assert.ok(html("Use `<b>` tags").includes("&lt;b&gt;</code>"));
    const block = html("```html\n<script>alert(1)</script>\n```");
    assert.ok(block.startsWith("<pre"));
    assert.ok(block.includes("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>"));
  });
});

describe("markdownToEmailHtml: rendering", () => {
  it("returns an empty string for empty input", () => {
    assert.equal(html(""), "");
    assert.equal(html("   \n  "), "");
  });

  it("renders paragraphs, line breaks and inline formatting", () => {
    const out = html("Hello **world**, *this* _is_ ~~old~~ ==new==.\nNext line");
    assert.match(out, /^<p [^>]*>Hello <strong[^>]*>world<\/strong>, <em>this<\/em> <em>is<\/em> <del>old<\/del> <mark[^>]*>new<\/mark>\.<br>Next line<\/p>$/);
  });

  it("keeps backslash escapes and intraword underscores literal", () => {
    assert.ok(html("\\*not emphasis\\*").includes("*not emphasis*"));
    assert.ok(html("snake_case_name").includes("snake_case_name"));
  });

  it("renders headings, rules, quotes and autolinks", () => {
    assert.match(html("# Title"), /^<h1 [^>]*>Title<\/h1>$/);
    assert.match(html("###### Six ###"), /^<h6 [^>]*>Six<\/h6>$/);
    assert.match(html("####### Seven"), /^<p /);
    assert.match(html("---"), /^<hr /);
    assert.match(html("> quoted **text**"), /^<blockquote [^>]*><p [^>]*>quoted <strong[^>]*>text<\/strong><\/p><\/blockquote>$/);
    assert.deepEqual(urls(html("See https://example.com/page. Thanks")), ["https://example.com/page"]);
  });

  it("renders ordered, nested and task lists", () => {
    const ordered = html("3. three\n4. four");
    assert.match(ordered, /^<ol start="3" /);
    assert.equal((ordered.match(/<li /g) ?? []).length, 2);
    const nested = html("- parent\n  - child\n- sibling");
    assert.match(nested, /<li [^>]*>parent<ul [^>]*><li [^>]*>child<\/li><\/ul><\/li><li [^>]*>sibling<\/li>/);
    const tasks = html("- [x] done\n- [ ] todo");
    assert.ok(tasks.includes("&#9745;</span> done"));
    assert.ok(tasks.includes("&#9744;</span> todo"));
    assert.ok(tasks.includes("list-style:none"));
  });

  it("renders tables with alignment", () => {
    const out = html("| Name | Score |\n|:-----|------:|\n| Ada | 10 |\n| Alan |");
    assert.match(out, /<th [^>]*text-align:left;[^>]*>Name<\/th><th [^>]*text-align:right;[^>]*>Score<\/th>/);
    assert.equal((out.match(/<tr>/g) ?? []).length, 3);
    assert.ok(out.includes(">Alan</td><td style=\"border:1px solid #e4e4e7;padding:6px 10px;text-align:right;\"></td>"));
  });

  it("uses the accent colour for links", () => {
    assert.ok(markdownToEmailHtml("[x](https://e.com)", { baseUrl: BASE, accentColor: "#ff0000" }).includes("color:#ff0000"));
  });
});

describe("markdownToText", () => {
  it("renders readable plain text", () => {
    assert.equal(text("Hello **world**"), "Hello world");
    assert.equal(text("[Docs](https://example.com/docs)"), "Docs (https://example.com/docs)");
    assert.equal(text("[https://example.com/](https://example.com/)"), "https://example.com/");
    assert.equal(text("[mail](mailto:ada@example.com)"), "mail (ada@example.com)");
    assert.equal(text("[course](/courses/x)"), "course (https://lms.test/courses/x)");
    assert.equal(text("[x](javascript:alert(1))"), "x");
    assert.equal(text("![Logo](https://cdn.example.com/l.png)"), "[Logo: https://cdn.example.com/l.png]");
  });

  it("keeps block structure", () => {
    assert.equal(text("# Title\n\nPara one.\n\n## Sub"), "Title\n=====\n\nPara one.\n\nSub\n---");
    assert.equal(text("- a\n- [x] b\n\n1. one\n2. two"), "- a\n- [x] b\n\n1. one\n2. two");
    assert.equal(text("> quoted\n> more"), "> quoted\n> more");
    assert.equal(text("Example:\n\n```\nconst a = 1;\nconst b = 2;\n```"), "Example:\n\n    const a = 1;\n    const b = 2;");
    assert.equal(text("| A | B |\n|---|---|\n| 1 | 2 |"), "A | B\n1 | 2");
    assert.equal(text(""), "");
  });
});

describe("escapeMarkdown", () => {
  it("makes user values render literally", () => {
    const name = "*Ada* [admin](javascript:alert(1)) <b>\nnext";
    const escaped = escapeMarkdown(name);
    assert.ok(!escaped.includes("\n"));
    const out = html(`Hello ${escaped}!`);
    assert.ok(!out.includes("<a ") && !out.includes("<em>") && !out.includes("<b>"));
    assert.ok(out.includes("*Ada* [admin](javascript:alert(1)) &lt;b&gt; next!"));
  });
});
