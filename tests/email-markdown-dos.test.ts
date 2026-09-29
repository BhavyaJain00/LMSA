import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToEmailHtml, markdownToText } from "@/lib/email/markdown";

/**
 * The email markdown renderer must stay linear on hostile input: authors
 * control up to 20,000 characters, and a quadratic parser blocked the event
 * loop for seconds per recipient (review finding: renderer DoS).
 */

const BASE = { baseUrl: "https://lms.test" };
const LIMIT_MS = 200;
const SIZE = 20_000;

function fill(unit: string): string {
  return unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
}

const ADVERSARIAL: Record<string, string> = {
  "unclosed *": fill("*a "),
  "unclosed _": fill("_a "),
  "unclosed **": fill("**a "),
  "unclosed ~~": fill("~~a "),
  "unclosed ==": fill("==a "),
  "unmatched [": "[".repeat(SIZE),
  "unmatched ![": fill("!["),
  "nested ![ ]": "![".repeat(SIZE / 4) + "]".repeat(SIZE / 2),
  "nested [ ](x)": "[".repeat(SIZE / 2) + "](x)".repeat(SIZE / 8),
  "link dests [](": fill("[]("),
  "link dests with parens": fill("[a](b("),
  "angle dests [a](<": fill("[a](<"),
  "unclosed titles": fill('[a](b "'),
  "backtick runs": Array.from({ length: 190 }, (_, i) => `${"`".repeat(i + 1)}x`).join(""),
  "mixed delimiters": fill("*_[~~==`"),
  backslashes: "\\".repeat(SIZE),
  "autolink tail": `(https://${".".repeat(SIZE - 9)}`,
  "heading with space run": `# a${" ".repeat(SIZE - 4)}b`,
  "fence with space run": `\`\`\`${" ".repeat(SIZE - 6)}x y`,
  "table separator space run": `a|b\n${" ".repeat(SIZE - 5)}x`,
  "rule-like line": `${"- ".repeat(SIZE / 2 - 1)}x`,
  "trailing blanks before newlines": fill(`a${" ".repeat(1000)}b\n`),
};

describe("email markdown renderer: linear time on adversarial input", () => {
  // Warm up the JIT so the first measured case isn't penalised.
  markdownToEmailHtml(fill("*a [b](c) `d` "), BASE);
  markdownToText(fill("*a [b](c) `d` "), BASE);

  for (const [name, input] of Object.entries(ADVERSARIAL)) {
    it(`renders ${name} (${input.length} chars) in under ${LIMIT_MS} ms`, () => {
      const started = performance.now();
      const html = markdownToEmailHtml(input, BASE);
      const text = markdownToText(input, BASE);
      const elapsed = performance.now() - started;
      assert.ok(html.length > 0 && text.length >= 0);
      assert.ok(elapsed < LIMIT_MS, `${name}: ${elapsed.toFixed(1)} ms`);
    });
  }

  it("never lets hostile input through as markup", () => {
    for (const input of Object.values(ADVERSARIAL)) {
      const html = markdownToEmailHtml(input, BASE);
      assert.ok(!/<script|javascript:/i.test(html));
    }
  });
});

describe("email markdown renderer: block helpers keep their meaning", () => {
  const html = (md: string) => markdownToEmailHtml(md, BASE);

  it("keeps a trailing # that is part of the heading text", () => {
    assert.match(html("# Learn C#"), /^<h1 [^>]*>Learn C#<\/h1>$/);
    assert.match(html("## Title ##"), /^<h2 [^>]*>Title<\/h2>$/);
    assert.match(html("#Nope"), /^<p /);
  });

  it("recognises fences, rules and table separators", () => {
    assert.match(html("```  js  \nconst a = 1;\n```"), /^<pre /);
    assert.match(html("```js extra words"), /^<p /);
    assert.match(html("* * *"), /^<hr /);
    assert.match(html("    ---"), /^<p /);
    assert.match(html("| a | b |\n| :-- | --: |\n| 1 | 2 |"), /^<table /);
    assert.match(html("a | b\n|  |"), /^<p /);
  });

  it("still matches emphasis and links correctly", () => {
    assert.equal(html("*a **b** c*"), '<p style="margin:0 0 16px;line-height:1.6;"><em>a <strong style="font-weight:600;">b</strong> c</em></p>');
    assert.ok(html("[x](https://e.com/a_(b)_c)").includes('href="https://e.com/a_(b)_c"'));
    assert.ok(html("`code with ``two`` ticks`").includes("<code"));
    assert.ok(html("[a `]` b](https://e.com)").includes('href="https://e.com/"'));
  });
});
