import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chunkText,
  chunkTranscript,
  cleanLessonMarkdown,
  DEFAULT_CHUNK_OPTIONS,
  isShortCode,
  markdownHeadings,
  splitMarkdownSections,
} from "@/lib/ai/chunk";
import { estimateTokens, formatTimestamp, refersToCurrentLesson, stem, tokenize, truncateToTokens } from "@/lib/ai/text";

/** A paragraph of roughly `tokens` estimated tokens made of distinct sentences. */
function paragraph(label: string, sentences: number): string {
  return Array.from({ length: sentences }, (_, i) => `Sentence ${i + 1} of ${label} explains one small idea about closures and scope.`).join(" ");
}

describe("ai tutor text helpers", () => {
  it("tokenizes with folding, stopwords, stemming and identifier splitting", () => {
    assert.deepEqual(tokenize("What are the Arrays?"), ["array"]);
    assert.deepEqual(tokenize("Café déjà vu"), ["cafe", "deja", "vu"]);
    const ident = tokenize("useState");
    assert.ok(ident.includes("usestate") && ident.includes("state"));
    assert.ok(tokenize("snake_case_name").includes("snake"));
    assert.equal(stem("closures"), "closure");
    assert.equal(stem("declared"), "declar");
    assert.equal(stem("libraries"), "library");
    assert.equal(stem("class"), "class");
    assert.equal(stem("http2"), "http2");
  });

  it("estimates and truncates tokens at a boundary", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("abcd"), 1);
    const long = "First sentence here. Second sentence is a bit longer. Third one ends it.";
    const cut = truncateToTokens(long, 10);
    assert.ok(cut.length < long.length);
    assert.ok(cut.endsWith("…"));
    assert.equal(truncateToTokens("short", 10), "short");
  });

  it("formats video timestamps", () => {
    assert.equal(formatTimestamp(0), "0:00");
    assert.equal(formatTimestamp(125), "2:05");
    assert.equal(formatTimestamp(3725), "1:02:05");
  });

  it("recognises questions about the lesson on screen", () => {
    assert.ok(refersToCurrentLesson("Can you summarize this lesson?"));
    assert.ok(refersToCurrentLesson("key points of the video please"));
    assert.ok(refersToCurrentLesson("What was this video about"));
    assert.ok(!refersToCurrentLesson("How does a closure capture variables?"));
  });
});

describe("ai tutor chunkText", () => {
  it("returns nothing for empty text and one chunk for short text", () => {
    assert.deepEqual(chunkText("   \n\n "), []);
    assert.deepEqual(chunkText("A short note."), ["A short note."]);
  });

  it("keeps chunks within the target..max window and overlaps neighbours", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(`part ${i + 1}`, 8)).join("\n\n");
    const chunks = chunkText(text);
    assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
    for (const chunk of chunks) assert.ok(estimateTokens(chunk) <= DEFAULT_CHUNK_OPTIONS.maxTokens, "chunk above max");
    for (const chunk of chunks.slice(0, -1)) assert.ok(estimateTokens(chunk) >= DEFAULT_CHUNK_OPTIONS.targetTokens - 200, "chunk far below target");
    // Overlap: the last paragraph of a chunk starts the next one.
    for (let i = 0; i < chunks.length - 1; i++) {
      const tail = chunks[i]!.split("\n\n").pop()!;
      if (estimateTokens(tail) <= DEFAULT_CHUNK_OPTIONS.overlapTokens) assert.ok(chunks[i + 1]!.startsWith(tail), `chunk ${i + 1} does not overlap`);
    }
    // Every paragraph appears somewhere.
    for (let i = 1; i <= 12; i++) assert.ok(chunks.some((c) => c.includes(`of part ${i} explains`)));
  });

  it("splits oversized paragraphs by sentence and never emits overlap-only chunks", () => {
    const text = paragraph("huge", 120);
    const chunks = chunkText(text, { targetTokens: 200, maxTokens: 260, overlapTokens: 30 });
    assert.ok(chunks.length > 3);
    for (const c of chunks) assert.ok(estimateTokens(c) <= 260);
    const unique = new Set(chunks);
    assert.equal(unique.size, chunks.length);
  });

  it("never splits a fenced code block that fits, and re-fences an oversized one", () => {
    const code = ["```js", ...Array.from({ length: 20 }, (_, i) => `const value${i} = compute(${i});`), "```"].join("\n");
    const text = `${paragraph("intro", 30)}\n\n${code}\n\n${paragraph("outro", 30)}`;
    const chunks = chunkText(text, { targetTokens: 300, maxTokens: 400, overlapTokens: 40 });
    const holder = chunks.filter((c) => c.includes("const value0"));
    assert.ok(holder.length >= 1);
    assert.ok(holder.every((c) => c.includes("const value19")), "code block was split");

    const big = ["```py", ...Array.from({ length: 200 }, (_, i) => `print("line number ${i} of the long script")`), "```"].join("\n");
    const pieces = chunkText(big, { targetTokens: 300, maxTokens: 400, overlapTokens: 0 });
    assert.ok(pieces.length > 1);
    for (const p of pieces) {
      assert.ok(p.startsWith("```py"), "piece lost its opening fence");
      assert.ok(p.trimEnd().endsWith("```"), "piece lost its closing fence");
      assert.ok(estimateTokens(p) <= 400);
    }
  });

  it("cuts a single enormous word", () => {
    const blob = "x".repeat(10_000);
    const chunks = chunkText(blob, { targetTokens: 500, maxTokens: 600, overlapTokens: 0 });
    assert.ok(chunks.length >= 4);
    for (const c of chunks) assert.ok(estimateTokens(c) <= 600);
  });
});

describe("ai tutor chunkTranscript", () => {
  const cues = Array.from({ length: 300 }, (_, i) => ({ start: i * 4, end: i * 4 + 4, text: `Cue ${i} talks about recursion and the call stack in detail.` }));

  it("keeps the start time of the first cue and overlaps by whole cues", () => {
    const chunks = chunkTranscript(cues);
    assert.ok(chunks.length > 2);
    assert.equal(chunks[0]!.start, 0);
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i]!.start > chunks[i - 1]!.start, "chunks must move forward");
      assert.ok(chunks[i]!.start < chunks[i - 1]!.end, "neighbouring chunks should overlap");
      assert.ok(estimateTokens(chunks[i]!.text) <= DEFAULT_CHUNK_OPTIONS.maxTokens);
    }
    assert.equal(chunks.at(-1)!.end, 300 * 4);
  });

  it("sorts cues, drops empty ones and survives bad numbers", () => {
    const chunks = chunkTranscript([
      { start: 10, end: 12, text: "second" },
      { start: 2, end: 4, text: "first" },
      { start: Number.NaN, end: 1, text: "broken" },
      { start: 20, end: 22, text: "   " },
    ]);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.text, "first second");
    assert.equal(chunks[0]!.start, 2);
  });
});

describe("ai tutor markdown helpers", () => {
  const md = [
    "Intro before headings.",
    "# Closures",
    "A closure keeps variables alive.",
    "## Why they *matter*",
    "They enable private state.",
    "```js",
    "# not a heading",
    "```",
    "### Deeper",
    "Details.",
    "# Next topic",
    "Other text.",
  ].join("\n");

  it("lists headings outside code fences", () => {
    const headings = markdownHeadings(md);
    assert.deepEqual(
      headings.map((h) => `${h.level}:${h.text}`),
      ["1:Closures", "2:Why they matter", "3:Deeper", "1:Next topic"],
    );
  });

  it("splits sections with heading paths", () => {
    const sections = splitMarkdownSections(md);
    assert.deepEqual(
      sections.map((s) => s.heading),
      ["", "Closures", "Closures › Why they matter", "Closures › Why they matter › Deeper", "Next topic"],
    );
    assert.ok(sections[2]!.body.includes("# not a heading"));
  });

  it("cleans lesson markdown: links to labels, images to alt text, no HTML, long code removed", () => {
    const longCode = ["```js", ...Array.from({ length: 80 }, (_, i) => `line${i}();`), "```"].join("\n");
    const input = [
      "See [the MDN guide](https://developer.mozilla.org/en-US/docs/Web(JS)) for more.",
      "![Diagram of the scope chain](/img/scope.png) ![](/img/decor.png)",
      "<div class=\"note\">Inline <b>HTML</b></div><!-- hidden comment -->",
      "```js",
      "const [a](b) = 1; // [kept](as-is)",
      "```",
      longCode,
      "After the code.",
    ].join("\n");
    const out = cleanLessonMarkdown(input);
    assert.ok(out.includes("See the MDN guide for more."));
    assert.ok(!out.includes("developer.mozilla.org"));
    assert.ok(out.includes("(Image: Diagram of the scope chain)"));
    assert.ok(!out.includes("decor.png"));
    assert.ok(out.includes("Inline HTML"));
    assert.ok(!out.includes("<div") && !out.includes("hidden comment"));
    assert.ok(out.includes("const [a](b) = 1; // [kept](as-is)"), "short code must stay verbatim");
    assert.ok(!out.includes("line79();"), "long code must be dropped");
    assert.ok(out.includes("After the code."));
  });

  it("measures short code", () => {
    assert.ok(isShortCode("let x = 1;"));
    assert.ok(!isShortCode("   "));
    assert.ok(!isShortCode("x\n".repeat(61)));
    assert.ok(!isShortCode("y".repeat(2401)));
  });
});
