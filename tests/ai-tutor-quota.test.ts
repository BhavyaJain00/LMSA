import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countQuestionsToday, DailyQuestionLedger, nextUtcMidnight, normalizeDailyLimit, quotaStatus, startOfUtcDay } from "@/lib/ai/quota";

const NOON = new Date("2026-03-10T12:00:00.000Z");

describe("ai tutor daily quota", () => {
  it("treats missing, zero and invalid limits as unlimited", () => {
    for (const limit of [0, -5, Number.NaN, undefined, null, "abc", Number.POSITIVE_INFINITY]) {
      assert.equal(normalizeDailyLimit(limit), 0, `limit ${String(limit)}`);
    }
    assert.equal(normalizeDailyLimit(25), 25);
    assert.equal(normalizeDailyLimit("40"), 40);
    assert.equal(normalizeDailyLimit(12.9), 12);

    const unlimited = quotaStatus(500, 0, NOON);
    assert.equal(unlimited.exceeded, false);
    assert.equal(unlimited.remaining, null);
    assert.equal(unlimited.limit, 0);
  });

  it("counts down and blocks exactly at the limit", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 7].map((used) => {
        const q = quotaStatus(used, 3, NOON);
        return [q.remaining, q.exceeded];
      }),
      [
        [3, false],
        [2, false],
        [1, false],
        [0, true],
        [0, true],
      ],
    );
    assert.equal(quotaStatus(-4, 3, NOON).used, 0, "a negative count is clamped");
  });

  it("resets at the next UTC midnight for everyone", () => {
    assert.equal(startOfUtcDay(NOON).toISOString(), "2026-03-10T00:00:00.000Z");
    assert.equal(nextUtcMidnight(NOON).toISOString(), "2026-03-11T00:00:00.000Z");
    assert.equal(quotaStatus(1, 5, new Date("2026-03-10T23:59:59.999Z")).resetsAt, "2026-03-11T00:00:00.000Z");
    assert.equal(quotaStatus(1, 5, new Date("2026-03-11T00:00:00.000Z")).resetsAt, "2026-03-12T00:00:00.000Z");
    assert.equal(nextUtcMidnight(new Date("2026-12-31T18:00:00.000Z")).toISOString(), "2027-01-01T00:00:00.000Z");
  });

  it("counts only today's questions in the learner's own conversations", () => {
    const messages = [
      { conversationId: "mine", role: "user", createdAt: "2026-03-10T00:00:00.000Z" },
      { conversationId: "mine", role: "assistant", createdAt: "2026-03-10T00:00:05.000Z" },
      { conversationId: "mine", role: "user", createdAt: "2026-03-10T11:59:00.000Z" },
      { conversationId: "mine", role: "user", createdAt: "2026-03-09T23:59:59.999Z" },
      { conversationId: "someone-else", role: "user", createdAt: "2026-03-10T08:00:00.000Z" },
      { conversationId: "mine-too", role: "user", createdAt: "2026-03-10T09:00:00.000Z" },
    ];
    assert.equal(countQuestionsToday(messages, new Set(["mine", "mine-too"]), NOON), 3);
    assert.equal(countQuestionsToday(messages, new Set(["mine"]), NOON), 2);
    assert.equal(countQuestionsToday(messages, new Set(), NOON), 0);
    assert.equal(countQuestionsToday(messages, new Set(["mine"]), new Date("2026-03-11T00:00:01.000Z")), 0, "yesterday's questions don't count");
  });
});

describe("ai tutor question ledger", () => {
  it("keeps the higher of the stored and remembered counts", () => {
    const ledger = new DailyQuestionLedger();
    assert.equal(ledger.used("u1", 0, NOON), 0);
    ledger.add("u1", NOON);
    ledger.add("u1", NOON);
    assert.equal(ledger.used("u1", 2, NOON), 2);
    // The learner deleted their conversations: the stored count drops, the day's usage doesn't.
    assert.equal(ledger.used("u1", 0, NOON), 2);
    // After a restart the ledger is empty and the stored messages are the floor.
    assert.equal(new DailyQuestionLedger().used("u1", 5, NOON), 5);
    assert.equal(ledger.used("u2", 0, NOON), 0, "learners are counted separately");
  });

  it("gives a question back when it got no answer", () => {
    const ledger = new DailyQuestionLedger();
    ledger.add("u1", NOON);
    ledger.remove("u1", NOON);
    assert.equal(ledger.used("u1", 0, NOON), 0);
    ledger.remove("u1", NOON);
    assert.equal(ledger.used("u1", 0, NOON), 0, "never goes below zero");
  });

  it("starts over when the UTC day changes", () => {
    const ledger = new DailyQuestionLedger();
    ledger.add("u1", NOON);
    ledger.add("u1", NOON);
    assert.equal(ledger.used("u1", 0, new Date("2026-03-10T23:59:59.000Z")), 2);
    assert.equal(ledger.used("u1", 0, new Date("2026-03-11T00:00:00.000Z")), 0);
  });

  it("stays bounded by dropping the least recently active learners", () => {
    const ledger = new DailyQuestionLedger(2);
    ledger.add("a", NOON);
    ledger.add("b", NOON);
    ledger.add("a", NOON); // "a" is now the most recent
    ledger.add("c", NOON); // evicts "b"
    assert.equal(ledger.used("a", 0, NOON), 2);
    assert.equal(ledger.used("c", 0, NOON), 1);
    assert.equal(ledger.used("b", 0, NOON), 0);
  });
});
