import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clusterQuestions, jaccard, questionKey } from "@/lib/ai/cluster";
import { dayRange, summarizeUsage, type UsageRow } from "@/lib/ai/usage";
import { estimateCostUsd, isValidModelId, supportsEffort } from "@/lib/ai/models";

const NOW = new Date("2026-03-10T15:00:00.000Z");
let seq = 0;

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  seq++;
  return {
    id: `msg_${seq}`,
    conversationId: "conv_1",
    courseId: "crs_a",
    lessonId: "les_1",
    learnerId: "usr_1",
    question: "What is a closure?",
    createdAt: "2026-03-10T09:00:00.000Z",
    flagged: false,
    unknown: false,
    tokensIn: 100,
    tokensOut: 20,
    ...overrides,
  };
}

describe("ai tutor question clustering", () => {
  it("normalises questions to sorted meaningful terms", () => {
    assert.deepEqual(questionKey("What is a closure?"), questionKey("what IS a   closure"));
    assert.deepEqual(questionKey("the and of"), [], "only stop words");
  });

  it("computes Jaccard similarity of term sets", () => {
    assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
    assert.equal(jaccard(["a", "b"], ["b", "c"]), 1 / 3);
    assert.equal(jaccard([], []), 1);
    assert.equal(jaccard(["a"], []), 0);
  });

  it("groups wordings of the same question and labels the group with its most common form", () => {
    const clusters = clusterQuestions([
      { id: "1", text: "What is a closure?", lessonId: "les_1", courseId: "crs_a" },
      { id: "2", text: "what is a closure", lessonId: "les_1", courseId: "crs_a" },
      { id: "3", text: "What is a closure?", lessonId: "les_2", courseId: "crs_a" },
      { id: "4", text: "How do promises work?", lessonId: "les_3", courseId: "crs_a" },
      { id: "5", text: "?!", lessonId: "les_3" },
    ]);
    assert.equal(clusters.length, 2, "the punctuation-only question is ignored");
    assert.equal(clusters[0]!.count, 3);
    assert.equal(clusters[0]!.label, "What is a closure?");
    assert.deepEqual(clusters[0]!.ids, ["1", "2", "3"]);
    assert.deepEqual(clusters[0]!.lessonIds, ["les_1", "les_2"]);
    assert.deepEqual(clusters[0]!.examples, ["What is a closure?", "what is a closure"]);
    assert.equal(clusters[1]!.label, "How do promises work?");
  });

  it("keeps unrelated questions apart and honours the limit", () => {
    const clusters = clusterQuestions(
      [
        { id: "1", text: "Explain closures in loops" },
        { id: "2", text: "Explain generators and yield" },
        { id: "3", text: "Explain closures in loops please" },
      ],
      { limit: 1 },
    );
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.count, 2);
  });
});

describe("ai tutor usage summary", () => {
  it("lists every UTC day of the period, oldest first", () => {
    assert.deepEqual(dayRange(3, NOW), ["2026-03-08", "2026-03-09", "2026-03-10"]);
    assert.deepEqual(dayRange(1, new Date("2026-01-01T00:30:00.000Z")), ["2026-01-01"]);
  });

  it("counts answers, tokens, feedback and learners inside the period only", () => {
    const usage = summarizeUsage(
      [
        row({ helpful: true, learnerId: "usr_1", conversationId: "c1" }),
        row({ helpful: false, flagged: true, learnerId: "usr_2", conversationId: "c2", createdAt: "2026-03-09T23:59:00.000Z" }),
        row({ unknown: true, learnerId: "usr_2", conversationId: "c2", createdAt: "2026-03-08T00:00:00.000Z" }),
        row({ createdAt: "2026-03-07T23:59:59.000Z", tokensIn: 9999 }),
      ],
      { days: 3, now: NOW },
    );
    assert.equal(usage.answers, 3);
    assert.equal(usage.conversations, 2);
    assert.equal(usage.learners, 2);
    assert.equal(usage.tokensIn, 300);
    assert.equal(usage.tokensOut, 60);
    assert.equal(usage.helpful, 1);
    assert.equal(usage.unhelpful, 1);
    assert.equal(usage.flagged, 1);
    assert.equal(usage.unknown, 1);
    assert.deepEqual(
      usage.daily.map((d) => [d.date, d.answers]),
      [
        ["2026-03-08", 1],
        ["2026-03-09", 1],
        ["2026-03-10", 1],
      ],
    );
  });

  it("ranks lessons by their \"I don't know\" rate to show content gaps", () => {
    const usage = summarizeUsage(
      [
        row({ lessonId: "les_a", unknown: true }),
        row({ lessonId: "les_a", unknown: false }),
        row({ lessonId: "les_b", unknown: true }),
        row({ lessonId: "les_c", unknown: false }),
        row({ lessonId: undefined, unknown: true }),
      ],
      { days: 7, now: NOW },
    );
    assert.deepEqual(
      usage.gaps.map((g) => [g.lessonId, g.answers, g.unknown, g.rate]),
      [
        ["les_b", 1, 1, 100],
        ["les_a", 2, 1, 50],
      ],
    );
    const strict = summarizeUsage([row({ lessonId: "les_b", unknown: true })], { days: 7, now: NOW, minGapAnswers: 2 });
    assert.deepEqual(strict.gaps, [], "lessons with too few questions are left out");
  });

  it("clusters the top questions and breaks usage down per course", () => {
    const usage = summarizeUsage(
      [
        row({ question: "What is a closure?", courseId: "crs_a", learnerId: "usr_1" }),
        row({ question: "what is a closure", courseId: "crs_a", learnerId: "usr_2" }),
        row({ question: "How do I install Node?", courseId: "crs_b", learnerId: "usr_1", unknown: true }),
      ],
      { days: 7, now: NOW },
    );
    assert.equal(usage.topQuestions[0]!.count, 2);
    assert.deepEqual(
      usage.courses.map((c) => [c.courseId, c.answers, c.learners, c.unknown]),
      [
        ["crs_a", 2, 2, 0],
        ["crs_b", 1, 1, 1],
      ],
    );
  });

  it("returns an empty summary with zero-filled days when nothing was asked", () => {
    const usage = summarizeUsage([], { days: 7, now: NOW });
    assert.equal(usage.answers, 0);
    assert.equal(usage.daily.length, 7);
    assert.ok(usage.daily.every((d) => d.answers === 0));
    assert.deepEqual(usage.topQuestions, []);
  });
});

describe("ai tutor model options", () => {
  it("validates model ids before they reach the API", () => {
    assert.ok(isValidModelId("claude-opus-5-5"));
    assert.ok(isValidModelId("claude-haiku-4-5-20251001"));
    assert.ok(!isValidModelId("Claude Opus"));
    assert.ok(!isValidModelId("x"));
    assert.ok(!isValidModelId("claude/../../v1"));
  });

  it("estimates cost from list prices and knows which models accept effort", () => {
    assert.equal(estimateCostUsd("claude-opus-5-5", 1_000_000, 100_000), 4 + 2);
    assert.equal(estimateCostUsd("my-fine-tune", 10, 10), null);
    assert.ok(supportsEffort("claude-opus-5-5"));
    assert.ok(!supportsEffort("claude-haiku-4-5"));
  });
});
