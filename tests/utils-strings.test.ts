import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  truncate,
  capitalize,
  titleCase,
  wordCount,
  readingTimeMinutes,
} from "@/lib/utils/strings";

describe("utils/strings", () => {
  it("truncate trims strings exceeding maxLength", () => {
    assert.equal(truncate("hello world", 20), "hello world");
    assert.equal(truncate("hello world", 8), "hello...");
    assert.equal(truncate("hello world", 5, "!"), "hell!");
    assert.equal(truncate("", 5), "");
  });

  it("capitalize capitalizes the first letter", () => {
    assert.equal(capitalize("typescript"), "Typescript");
    assert.equal(capitalize("Already"), "Already");
    assert.equal(capitalize(""), "");
  });

  it("titleCase converts phrases to title case", () => {
    assert.equal(titleCase("introduction to next.js"), "Introduction To Next.js");
    assert.equal(titleCase("LEARNLOOP LMS"), "Learnloop Lms");
  });

  it("wordCount counts whitespace-separated tokens accurately", () => {
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("   "), 0);
    assert.equal(wordCount("one two three"), 3);
    assert.equal(wordCount("  multiline\nword\ttest  "), 3);
  });

  it("readingTimeMinutes estimates duration based on WPM", () => {
    assert.equal(readingTimeMinutes(""), 0);
    const text100 = new Array(100).fill("word").join(" ");
    assert.equal(readingTimeMinutes(text100, 200), 1);
    const text500 = new Array(500).fill("word").join(" ");
    assert.equal(readingTimeMinutes(text500, 200), 3);
  });
});
