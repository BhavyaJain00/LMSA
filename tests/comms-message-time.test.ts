import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextMessageTime } from "@/lib/comms/messages";

describe("nextMessageTime", () => {
  const now = "2026-10-05T10:00:00.000Z";

  it("keeps the send time for the first message", () => {
    assert.equal(nextMessageTime(now, []), now);
  });

  it("keeps the send time when every earlier message is older", () => {
    assert.equal(nextMessageTime(now, [{ createdAt: "2026-10-05T09:59:59.999Z" }, { createdAt: "2026-10-04T10:00:00.000Z" }]), now);
  });

  it("moves a message sent in the same millisecond 1 ms later", () => {
    assert.equal(nextMessageTime(now, [{ createdAt: now }]), "2026-10-05T10:00:00.001Z");
  });

  it("stays after the latest message when the clock went backwards", () => {
    assert.equal(nextMessageTime(now, [{ createdAt: "2026-10-05T10:00:02.500Z" }, { createdAt: now }]), "2026-10-05T10:00:02.501Z");
  });

  it("orders a burst of same-millisecond messages strictly", () => {
    const sent: { createdAt: string }[] = [];
    for (let i = 0; i < 5; i++) sent.push({ createdAt: nextMessageTime(now, sent) });
    const times = sent.map((m) => m.createdAt);
    assert.deepEqual([...times].sort(), times);
    assert.equal(new Set(times).size, 5);
  });

  it("ignores an unparseable stored timestamp instead of throwing", () => {
    assert.equal(nextMessageTime(now, [{ createdAt: "zzz" }]), now);
  });
});
