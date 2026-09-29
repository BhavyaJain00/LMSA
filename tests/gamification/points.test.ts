import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Activity, Database } from "@/lib/types";
import {
  LEVEL_TIERS,
  formatSignedPoints,
  getLevelInfo,
  levelForPoints,
  pointsForLevel,
  tierForLevel,
} from "@/components/gamification/levels";
import { DISCUSSION_REPLY_DAILY_CAP, isPointsReason } from "@/components/gamification/reasons";
import { addManualAdjustment, awardPoints, buildLedgerFromHistory, recalculatePointsLedger, revokePoints, setPointsAward } from "@/lib/services/points";
import { getStreak, logActivity } from "@/lib/services/activity";
import { COLLECTIONS, getDb } from "@/lib/db/store";
import { addDays, toDateKey } from "@/lib/utils";
import { buildSettings, makeEnrollment, makeProgress, makeUser, resetDb } from "../helpers/db";

const ada = makeUser({ id: "usr_ada" });
const bob = makeUser({ id: "usr_bob" });

describe("levels", () => {
  it("follows 50 × (level − 1)² points per level", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(pointsForLevel), [0, 50, 200, 450, 800]);
    assert.equal(levelForPoints(0), 1);
    assert.equal(levelForPoints(49), 1);
    assert.equal(levelForPoints(50), 2);
    assert.equal(levelForPoints(199), 2);
    assert.equal(levelForPoints(200), 3);
    assert.equal(levelForPoints(-100), 1);
    assert.equal(levelForPoints(Number.NaN), 1);
    for (let level = 1; level <= 60; level++) {
      assert.equal(levelForPoints(pointsForLevel(level)), level);
      assert.equal(levelForPoints(pointsForLevel(level) - 1), Math.max(1, level - 1));
    }
  });

  it("describes progress towards the next level and tier", () => {
    const info = getLevelInfo(125);
    assert.deepEqual([info.level, info.levelStart, info.nextLevelAt, info.pointsToNext, info.progress, info.tier], [2, 50, 200, 75, 50, "Beginner"]);
    assert.deepEqual(info.nextTier, { name: "Learner", level: 3, pointsAt: 200 });
    assert.equal(tierForLevel(15).name, "Legend");
    assert.equal(getLevelInfo(pointsForLevel(20)).nextTier, null);
    assert.equal(LEVEL_TIERS[0].minLevel, 1);
  });

  it("formats signed points with a real minus sign", () => {
    assert.equal(formatSignedPoints(1250), "+1,250");
    assert.equal(formatSignedPoints(-10), "−10");
    assert.equal(formatSignedPoints(0), "0");
    assert.equal(isPointsReason("quiz_pass"), true);
    assert.equal(isPointsReason("constructor"), false);
  });
});

describe("points ledger (store)", () => {
  beforeEach(async () => {
    await resetDb({ users: [ada, bob], settings: { email: { enabled: false } } });
  });

  it("awards each (user, reason, ref) once, even under concurrent calls", async () => {
    const first = await awardPoints(ada.id, "lesson_complete", { refId: "les_1", courseId: "crs_1" });
    assert.equal(first?.points, 10);
    assert.equal(await awardPoints(ada.id, "lesson_complete", { refId: "les_1" }), null);
    await Promise.all([awardPoints(ada.id, "quiz_pass", { refId: "quiz_1" }), awardPoints(ada.id, "quiz_pass", { refId: "quiz_1" }), awardPoints(ada.id, "quiz_pass", { refId: "quiz_1" })]);
    assert.ok(await awardPoints(bob.id, "lesson_complete", { refId: "les_1" }));
    const db = await getDb();
    assert.equal(db.points.filter((p) => p.userId === ada.id && p.reason === "quiz_pass").length, 1);
    assert.equal(db.points.length, 3);
  });

  it("pays learning days once per day and manual adjustments every time", async () => {
    assert.ok(await awardPoints(ada.id, "streak_day"));
    assert.equal(await awardPoints(ada.id, "streak_day"), null);
    assert.ok(await awardPoints(ada.id, "streak_day", { refId: "2026-01-01" }));
    assert.equal((await addManualAdjustment(ada.id, 15, "Helpful answer"))?.points, 15);
    assert.equal((await addManualAdjustment(ada.id, 15, "Helpful answer"))?.points, 15);
    assert.equal(await addManualAdjustment(ada.id, 0, "nothing"), null);
    assert.equal(await addManualAdjustment(ada.id, 1e9, "too much"), null);
  });

  it("caps discussion reply points per day", async () => {
    for (let i = 0; i < DISCUSSION_REPLY_DAILY_CAP + 3; i++) await awardPoints(ada.id, "discussion_reply", { refId: `rep_${i}` });
    assert.equal((await getDb()).points.filter((p) => p.reason === "discussion_reply").length, DISCUSSION_REPLY_DAILY_CAP);
  });

  it("does nothing while gamification is off, for unknown users or zero values", async () => {
    await resetDb({ users: [ada], settings: { gamification: { enabled: false } } });
    assert.equal(await awardPoints(ada.id, "lesson_complete", { refId: "les_1" }), null);
    await resetDb({ users: [ada], settings: { gamification: { points: { review: 0 } } } });
    assert.equal(await awardPoints(ada.id, "review", { refId: "crs_1" }), null);
    assert.equal(await awardPoints("usr_ghost", "lesson_complete", { refId: "les_1" }), null);
    assert.equal(await awardPoints(ada.id, "hacked" as never), null);
  });

  it("revokes and re-awards results that can change", async () => {
    await setPointsAward(ada.id, "assignment_pass", true, { refId: "asg_1" });
    assert.equal((await getDb()).points.length, 1);
    await setPointsAward(ada.id, "assignment_pass", false, { refId: "asg_1" });
    assert.equal((await getDb()).points.length, 0);
    await awardPoints(ada.id, "quiz_pass", { refId: "quiz_1" });
    assert.equal(await revokePoints("quiz_pass", ["quiz_1", ""], bob.id), 0);
    assert.equal(await revokePoints("quiz_pass", "quiz_1"), 1);
  });

  it("notifies members when they reach a new level", async () => {
    await awardPoints(ada.id, "course_complete", { refId: "crs_1" });
    const db = await getDb();
    assert.ok(db.notifications.some((n) => n.userId === ada.id && n.subject === "You reached level 2!"));
  });
});

describe("ledger rebuild", () => {
  it("rebuilds points from history without duplicates", () => {
    const empty = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
    const db = {
      ...empty,
      users: [ada, bob],
      lessons: [{ id: "les_1", courseId: "crs_1" }],
      progress: [
        makeProgress({ id: "les_1", courseId: "crs_1", chapterId: "c" }, ada.id),
        makeProgress({ id: "les_1", courseId: "crs_1", chapterId: "c" }, ada.id),
        makeProgress({ id: "les_deleted", courseId: "crs_1", chapterId: "c" }, ada.id),
        makeProgress({ id: "les_1", courseId: "crs_1", chapterId: "c" }, bob.id, { status: "partial" }),
      ],
      enrollments: [makeEnrollment({ userId: ada.id, courseId: "crs_1", completedAt: "2026-01-10T00:00:00Z" })],
      activities: [
        { id: "a1", userId: ada.id, date: "2026-01-02", type: "lesson_view", createdAt: "2026-01-02T08:00:00Z" },
        { id: "a2", userId: ada.id, date: "2026-01-02", type: "quiz_submit", createdAt: "2026-01-02T09:00:00Z" },
        { id: "a3", userId: ada.id, date: "2026-01-03", type: "login", createdAt: "2026-01-03T09:00:00Z" },
        { id: "a4", userId: "usr_ghost", date: "2026-01-03", type: "lesson_view", createdAt: "2026-01-03T09:00:00Z" },
      ] satisfies Activity[],
      settings: buildSettings(),
    } as unknown as Database;
    const ledger = buildLedgerFromHistory(db);
    assert.deepEqual(ledger.map((p) => [p.userId, p.reason, p.refId, p.points]).sort(), [
      [ada.id, "course_complete", "crs_1", 100],
      [ada.id, "lesson_complete", "les_1", 10],
      [ada.id, "streak_day", "2026-01-02", 5],
    ]);
  });

  it("recalculation keeps manual adjustments (store)", async () => {
    await resetDb({ users: [ada], enrollments: [makeEnrollment({ userId: ada.id, courseId: "crs_1", completedAt: "2026-01-10T00:00:00Z" })], settings: { email: { enabled: false } } });
    await addManualAdjustment(ada.id, -5, "Penalty");
    const result = await recalculatePointsLedger();
    assert.equal(result.manualKept, 1);
    assert.equal(result.totalPoints, 95);
    assert.deepEqual(result.byReason.map((r) => r.reason), ["course_complete", "manual"]);
  });
});

describe("streaks (store)", () => {
  const day = (offset: number) => toDateKey(addDays(new Date(), offset));
  const activity = (offset: number, type: Activity["type"] = "lesson_view"): Activity => ({ id: `act_${offset}_${type}`, userId: ada.id, date: day(offset), type, createdAt: new Date().toISOString() });

  it("counts consecutive days back from today", async () => {
    await resetDb({ users: [ada], activities: [activity(0), activity(-1), activity(-2), activity(-4), activity(-5), activity(-6), activity(-7)] });
    const streak = await getStreak(ada.id);
    assert.equal(streak.activeToday, true);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 4);
  });

  it("keeps yesterday's streak alive until the day ends", async () => {
    await resetDb({ users: [ada], activities: [activity(-1), activity(-2)] });
    const streak = await getStreak(ada.id);
    assert.deepEqual([streak.activeToday, streak.current, streak.longest], [false, 2, 2]);
    await resetDb({ users: [ada], activities: [activity(-2)] });
    assert.equal((await getStreak(ada.id)).current, 0);
  });

  it("logs one activity row per day, type and item, and pays learning days", async () => {
    await resetDb({ users: [ada], settings: { email: { enabled: false } } });
    await logActivity(ada.id, "lesson_view", "les_1");
    await logActivity(ada.id, "lesson_view", "les_1");
    await logActivity(ada.id, "login");
    const db = await getDb();
    assert.equal(db.activities.length, 2);
    assert.deepEqual(db.points.map((p) => [p.reason, p.refId]), [["streak_day", day(0)]]);
  });
});
