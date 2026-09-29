import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PointsEntry, PointsReason } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { awardPoints, getLeaderboard, getRankSummary } from "@/lib/services/points";
import { makeCourse, makeUser, resetDb } from "./helpers/db";

/**
 * Micro-benchmark: the ledger index keeps leaderboards, the dashboard widget
 * and award heartbeats cheap on a large ledger (200k entries). Before the
 * index, one leaderboard took ~0.5 s and one dashboard render ~1.1 s here.
 */
describe("points ledger performance (200k entries)", () => {
  it("serves boards, rank summaries and heartbeats quickly", async (ctx) => {
    const users = Array.from({ length: 2000 }, (_, i) => makeUser({ id: `usr_p${i}`, name: `Member ${i}` }));
    const courses = Array.from({ length: 10 }, (_, i) => makeCourse({ id: `crs_p${i}` }));
    await resetDb({ users, courses, settings: { email: { enabled: false }, gamification: { ledgerBuiltAt: new Date().toISOString() } } });

    const reasons: PointsReason[] = ["lesson_complete", "quiz_pass", "streak_day", "discussion_reply"];
    const now = Date.now();
    const points: PointsEntry[] = [];
    for (let i = 0; i < 200_000; i++) {
      const u = i % users.length;
      points.push({
        id: `pts_${i}`,
        userId: users[u]!.id,
        points: 5 + (i % 20),
        reason: reasons[i % reasons.length]!,
        refId: `ref_${i}`,
        courseId: i % 3 === 0 ? courses[i % courses.length]!.id : undefined,
        createdAt: new Date(now - (i % (60 * 24)) * 3_600_000).toISOString(),
      });
    }
    await mutate((d) => {
      d.points = points;
    });

    let t = performance.now();
    const first = await getLeaderboard({ viewer: users[5]!, period: "week" });
    const firstMs = performance.now() - t;
    assert.ok(first.rows.length > 0);
    assert.ok(firstMs < 3000, `first leaderboard incl. index build took ${firstMs.toFixed(0)} ms`);

    // A live award changes the ledger version, so the next reads recompute from the index.
    await awardPoints(users[7]!.id, "manual", { points: 1, note: "bench" });
    t = performance.now();
    for (const period of ["week", "month", "all"] as const) {
      await getLeaderboard({ viewer: users[5]!, period });
      await getLeaderboard({ viewer: users[5]!, period, courseId: courses[1]!.id });
    }
    const boardsMs = performance.now() - t;
    assert.ok(boardsMs < 600, `six leaderboards took ${boardsMs.toFixed(0)} ms`);

    t = performance.now();
    const summary = await getRankSummary(users[9]!);
    const summaryMs = performance.now() - t;
    assert.ok(summary.allTime.rank !== null);
    assert.ok(summaryMs < 200, `rank summary took ${summaryMs.toFixed(0)} ms`);

    // Heartbeats: the award already exists, so each call must be an O(1) no-op.
    const day = new Date().toISOString().slice(0, 10);
    await awardPoints(users[3]!.id, "streak_day", { refId: day });
    t = performance.now();
    for (let i = 0; i < 2000; i++) await awardPoints(users[3]!.id, "streak_day", { refId: day });
    const perBeat = (performance.now() - t) / 2000;
    ctx.diagnostic(`first board ${firstMs.toFixed(0)} ms, six boards ${boardsMs.toFixed(0)} ms, rank summary ${summaryMs.toFixed(1)} ms, heartbeat ${perBeat.toFixed(3)} ms`);
    assert.ok(perBeat < 0.5, `heartbeat award took ${perBeat.toFixed(3)} ms`);
  });
});
