import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffLines, diffSequence, lcsLength, splitDiffLines } from "@/lib/teaching/text-diff";

/** Compact form of a diff: "=a", "-b", "+c". */
function shape<T>(ops: readonly { type: string; value: T }[]): string[] {
  return ops.map((op) => `${op.type === "equal" ? "=" : op.type === "remove" ? "-" : "+"}${String(op.value)}`);
}

/** Replays a diff: the "before" side is equal + remove, the "after" side is equal + add. */
function replay<T>(ops: readonly { type: string; value: T }[]): { before: T[]; after: T[] } {
  return {
    before: ops.filter((op) => op.type !== "add").map((op) => op.value),
    after: ops.filter((op) => op.type !== "remove").map((op) => op.value),
  };
}

describe("teaching-tools text diff: diffSequence", () => {
  it("reports identical sequences as all equal", () => {
    const diff = diffSequence(["a", "b", "c"], ["a", "b", "c"]);
    assert.deepEqual(shape(diff.ops), ["=a", "=b", "=c"]);
    assert.equal(diff.coarse, false);
  });

  it("handles empty sides", () => {
    assert.deepEqual(diffSequence([], []).ops, []);
    assert.deepEqual(shape(diffSequence([], ["a", "b"]).ops), ["+a", "+b"]);
    assert.deepEqual(shape(diffSequence(["a", "b"], []).ops), ["-a", "-b"]);
  });

  it("finds an insertion, a removal and a replacement in the middle", () => {
    assert.deepEqual(shape(diffSequence(["a", "c"], ["a", "b", "c"]).ops), ["=a", "+b", "=c"]);
    assert.deepEqual(shape(diffSequence(["a", "b", "c"], ["a", "c"]).ops), ["=a", "-b", "=c"]);
    assert.deepEqual(shape(diffSequence(["a", "b", "c"], ["a", "x", "c"]).ops), ["=a", "-b", "+x", "=c"]);
  });

  it("lists removals before additions inside a changed region", () => {
    const diff = diffSequence(["a", "b", "c", "d"], ["a", "x", "y", "d"]);
    assert.deepEqual(shape(diff.ops), ["=a", "-b", "-c", "+x", "+y", "=d"]);
  });

  it("keeps the longest common subsequence", () => {
    const before = ["a", "b", "c", "a", "b", "b", "a"];
    const after = ["c", "b", "a", "b", "a", "c"];
    const diff = diffSequence(before, after);
    assert.equal(diff.ops.filter((op) => op.type === "equal").length, 4);
    assert.equal(lcsLength(before, after), 4);
    assert.deepEqual(replay(diff.ops), { before, after });
  });

  it("carries the index of each item on its own side", () => {
    const diff = diffSequence(["a", "b", "c"], ["a", "x", "c"]);
    assert.deepEqual(
      diff.ops.map((op) => [op.type, op.a, op.b]),
      [
        ["equal", 0, 0],
        ["remove", 1, undefined],
        ["add", undefined, 1],
        ["equal", 2, 2],
      ],
    );
  });

  it("uses the custom equality", () => {
    const diff = diffSequence(["Alpha", "beta"], ["alpha", "BETA", "gamma"], { equals: (a, b) => a.toLowerCase() === b.toLowerCase() });
    assert.deepEqual(shape(diff.ops), ["=alpha", "=BETA", "+gamma"]);
  });

  it("falls back to a coarse but correct diff when the table would be too large", () => {
    const before = ["same", "a", "b", "c", "end"];
    const after = ["same", "c", "x", "a", "end"];
    const diff = diffSequence(before, after, { maxCells: 4 });
    assert.equal(diff.coarse, true);
    assert.deepEqual(shape(diff.ops), ["=same", "-a", "-b", "-c", "+c", "+x", "+a", "=end"]);
    assert.deepEqual(replay(diff.ops), { before, after });
  });

  it("round-trips arbitrary edits", () => {
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    for (let round = 0; round < 40; round++) {
      const before = Array.from({ length: next(12) }, () => String.fromCharCode(97 + next(4)));
      const after = Array.from({ length: next(12) }, () => String.fromCharCode(97 + next(4)));
      assert.deepEqual(replay(diffSequence(before, after).ops), { before, after }, `${before.join("")} -> ${after.join("")}`);
    }
  });
});

describe("teaching-tools text diff: lines", () => {
  it("splits text into lines without counting one final newline", () => {
    assert.deepEqual(splitDiffLines(""), []);
    assert.deepEqual(splitDiffLines("a"), ["a"]);
    assert.deepEqual(splitDiffLines("a\n"), ["a"]);
    assert.deepEqual(splitDiffLines("a\n\nb"), ["a", "", "b"]);
    assert.deepEqual(splitDiffLines("a\r\nb\rc"), ["a", "b", "c"]);
  });

  it("diffs markdown line by line", () => {
    const before = "# Title\n\nFirst paragraph.\nSecond paragraph.\n";
    const after = "# Title\n\nFirst paragraph, edited.\nSecond paragraph.\nA new line.";
    assert.deepEqual(shape(diffLines(before, after).ops), [
      "=# Title",
      "=",
      "-First paragraph.",
      "+First paragraph, edited.",
      "=Second paragraph.",
      "+A new line.",
    ]);
  });

  it("treats Windows and Unix line endings as the same text", () => {
    const diff = diffLines("a\r\nb\r\n", "a\nb");
    assert.ok(diff.ops.every((op) => op.type === "equal"));
  });
});
