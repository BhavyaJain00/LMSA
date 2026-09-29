import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  buildReleaseTimeline,
  cleanReleaseRule,
  computeLessonLocks,
  countdownParts,
  dateKeyToUtcMs,
  describeReleaseRule,
  dripAnchor,
  findPrerequisiteCycle,
  formatDateKey,
  formatUnlockLabel,
  legacyLockReason,
  nextUnlockTime,
  normalizeDripDays,
  pickContinueLesson,
  prerequisiteMessage,
  releaseTime,
  resolvePrerequisites,
  shortRuleLabel,
  unmetPrerequisites,
  validateReleaseInput,
  type LockContext,
  type LockInputLesson,
} from "@/components/learn/drip-shared";
import { getCourseOutline } from "@/lib/data/courses";
import { getLessonAccess } from "@/lib/data/lessons";
import { makeCourse, makeCourseTree, makeEnrollment, makeProgress, makeUser, resetDb } from "../helpers/db";

const NOW = Date.UTC(2026, 5, 15, 12, 0);
const ENROLLED = Date.UTC(2026, 5, 10, 12, 0);

const lesson = (overrides: Partial<LockInputLesson> = {}): LockInputLesson => ({ id: `l${Math.random()}`, status: "incomplete", includeInPreview: false, chapter: {}, ...overrides });
const ctx = (overrides: Partial<LockContext> = {}): LockContext => ({
  manager: false,
  enrolled: true,
  previewAllowed: true,
  enforceOrder: false,
  anchor: ENROLLED,
  prerequisitesPending: false,
  now: NOW,
  ...overrides,
});

describe("release rules", () => {
  it("parses dates and drip days strictly", () => {
    assert.equal(dateKeyToUtcMs("2026-06-15"), Date.UTC(2026, 5, 15));
    assert.equal(dateKeyToUtcMs("2026-02-30"), null);
    assert.equal(dateKeyToUtcMs("15/06/2026"), null);
    assert.equal(normalizeDripDays("7"), 7);
    assert.equal(normalizeDripDays(0), undefined);
    assert.equal(normalizeDripDays(2.5), undefined);
    assert.equal(normalizeDripDays(99999), 3650);
    assert.deepEqual(cleanReleaseRule({ dripDays: 0, availableFrom: "bad" }), {});
    assert.deepEqual(cleanReleaseRule({ dripDays: 3, availableFrom: "2026-07-01" }), { dripDays: 3, availableFrom: "2026-07-01" });
  });

  it("validates admin input", () => {
    assert.deepEqual(validateReleaseInput({ dripDays: "", availableFrom: "" }), { ok: true, rule: {} });
    assert.deepEqual(validateReleaseInput({ dripDays: "0" }), { ok: true, rule: {} });
    assert.deepEqual(validateReleaseInput({ dripDays: " 14 ", availableFrom: "2026-09-01" }), { ok: true, rule: { dripDays: 14, availableFrom: "2026-09-01" } });
    const bad = validateReleaseInput({ dripDays: "1.5", availableFrom: "2026-02-30" });
    assert.ok(!bad.ok && bad.errors.dripDays && bad.errors.availableFrom);
    const far = validateReleaseInput({ dripDays: "4000", availableFrom: "1999-12-31" });
    assert.ok(!far.ok && /3,650/.test(far.errors.dripDays!) && /2000 and 2200/.test(far.errors.availableFrom!));
  });

  it("anchors drip days on the enrollment, or the batch start for batch enrollments", () => {
    assert.equal(dripAnchor({ enrolledAt: "2026-06-10T12:00:00.000Z" }, null), ENROLLED);
    assert.equal(dripAnchor({ enrolledAt: "2026-06-10T12:00:00.000Z", batchId: "b" }, { startDate: "2026-07-01", startTime: "09:00", timezone: "Asia/Kolkata" }), Date.UTC(2026, 6, 1, 3, 30));
    assert.ok(Number.isNaN(dripAnchor({ enrolledAt: "garbage" }, null)));
  });

  it("releases at the latest of the chapter and lesson rules", () => {
    assert.equal(releaseTime({}, {}, ENROLLED), null);
    assert.equal(releaseTime({ dripDays: 7 }, { dripDays: 3 }, ENROLLED), ENROLLED + 7 * DAY_MS);
    assert.equal(releaseTime({ availableFrom: "2026-08-01" }, { dripDays: 3 }, ENROLLED), Date.UTC(2026, 7, 1));
    // Without an enrollment only fixed dates apply.
    assert.equal(releaseTime({ dripDays: 7 }, {}, null), null);
    assert.equal(releaseTime({}, { availableFrom: "2026-06-20" }, null), Date.UTC(2026, 5, 20));
  });
});

describe("computeLessonLocks", () => {
  it("opens everything for managers", () => {
    assert.deepEqual(computeLessonLocks([lesson({ dripDays: 30 }), lesson()], ctx({ manager: true, enforceOrder: true })), [null, null]);
  });

  it("locks non-enrolled viewers out of everything but open free previews", () => {
    const locks = computeLessonLocks([lesson({ includeInPreview: true }), lesson(), lesson({ includeInPreview: true, availableFrom: "2026-07-01" })], ctx({ enrolled: false, anchor: null }));
    assert.equal(locks[0], null);
    assert.deepEqual(locks[1], { reason: "enroll" });
    assert.equal(locks[2]?.reason, "drip");
    assert.deepEqual(computeLessonLocks([lesson()], ctx({ enrolled: false, prerequisitesPending: true }))[0], { reason: "prerequisite" });
    assert.deepEqual(computeLessonLocks([lesson({ includeInPreview: true })], ctx({ enrolled: false, previewAllowed: false }))[0], { reason: "enroll" });
  });

  it("drip-locks enrolled learners until the release time", () => {
    const locks = computeLessonLocks([lesson({ dripDays: 3 }), lesson({ dripDays: 10 }), lesson({ chapter: { dripDays: 10 }, status: "complete" })], ctx());
    assert.equal(locks[0], null);
    assert.deepEqual(locks[1], { reason: "drip", unlocksAt: new Date(ENROLLED + 10 * DAY_MS).toISOString() });
    assert.equal(locks[2], null, "completed lessons never lock again");
  });

  it("free previews ignore drip days for enrolled learners too", () => {
    assert.equal(computeLessonLocks([lesson({ includeInPreview: true, dripDays: 30 })], ctx())[0], null);
  });

  it("enforces lesson order after the first incomplete lesson", () => {
    const locks = computeLessonLocks(
      [lesson({ status: "complete" }), lesson({ status: "partial" }), lesson(), lesson({ status: "complete" }), lesson({ dripDays: 30 })],
      ctx({ enforceOrder: true }),
    );
    assert.deepEqual(locks.slice(0, 4), [null, null, { reason: "order" }, null]);
    assert.equal(locks[4]?.reason, "drip");
    assert.equal(locks[4]?.afterPrevious, true);
    assert.equal(legacyLockReason(locks[2]), "sequential");
    assert.equal(legacyLockReason(locks[4]), undefined);
    assert.equal(legacyLockReason({ reason: "prerequisite" }), "enroll");
  });

  it("finds the next unlock and where to continue", () => {
    const locks = computeLessonLocks([lesson({ dripDays: 10 }), lesson({ dripDays: 7 }), lesson()], ctx());
    assert.equal(nextUnlockTime(locks, NOW), ENROLLED + 7 * DAY_MS);
    assert.equal(nextUnlockTime(locks, ENROLLED + 20 * DAY_MS), null);
    const rows = [
      { id: "a", status: "complete" as const, locked: false },
      { id: "b", status: "incomplete" as const, locked: false },
      { id: "c", status: "incomplete" as const, locked: true, lock: { reason: "order" as const } },
    ];
    assert.equal(pickContinueLesson(rows)?.id, "b");
    assert.equal(pickContinueLesson(rows, "c")?.id, "b");
    const scheduled = [
      { id: "a", status: "complete" as const, locked: false },
      { id: "b", status: "incomplete" as const, locked: true, lock: { reason: "drip" as const } },
    ];
    assert.equal(pickContinueLesson(scheduled), null);
    assert.equal(pickContinueLesson([{ id: "a", status: "complete" as const, locked: false }])?.id, "a");
  });
});

describe("prerequisites", () => {
  const courses = [
    { id: "c1", slug: "one", title: "One", published: true },
    { id: "c2", slug: "two", title: "Two", published: true },
    { id: "c3", slug: "three", title: "Three", published: false },
  ];
  const enrollments = [
    { userId: "u", courseId: "c1", progress: 100, completedAt: "2026-01-01T00:00:00Z" },
    { userId: "u", courseId: "c2", progress: 40 },
  ];

  it("resolves the viewer's state for each prerequisite", () => {
    const items = resolvePrerequisites(["c1", "c2", "c3", "c1", "missing", "self"], { courses, enrollments }, "u", "self");
    assert.deepEqual(items.map((i) => [i.courseId, i.state, i.progress]), [
      ["c1", "completed", 100],
      ["c2", "in_progress", 40],
    ]);
    assert.deepEqual(unmetPrerequisites(items).map((i) => i.courseId), ["c2"]);
    assert.equal(resolvePrerequisites(["c2"], { courses, enrollments }, null)[0]!.state, "unknown");
    assert.equal(resolvePrerequisites(["c2"], { courses, enrollments: [] }, "u")[0]!.state, "not_started");
    assert.deepEqual(resolvePrerequisites(undefined, { courses, enrollments }, "u"), []);
  });

  it("writes a readable message", () => {
    assert.equal(prerequisiteMessage([]), "");
    assert.equal(prerequisiteMessage([{ title: "A" }]), "Complete “A” before enrolling in this course.");
    assert.equal(prerequisiteMessage([{ title: "A" }, { title: "B" }, { title: "C" }]), "Complete “A”, “B” and “C” before enrolling in this course.");
  });

  it("detects prerequisite cycles", () => {
    const graph = new Map<string, string[]>([
      ["b", ["c"]],
      ["c", ["a"]],
      ["d", []],
    ]);
    assert.equal(findPrerequisiteCycle("a", ["d", "b"], graph), "b");
    assert.equal(findPrerequisiteCycle("a", ["d"], graph), null);
    assert.equal(findPrerequisiteCycle("a", ["a"], graph), "a");
  });
});

describe("formatting and the admin timeline", () => {
  it("formats rules and unlock labels", () => {
    assert.equal(formatDateKey("2026-10-04"), "Oct 4, 2026");
    assert.equal(formatDateKey("2026-10-04", false), "Oct 4");
    assert.equal(shortRuleLabel({ dripDays: 7, availableFrom: "2026-10-04" }), "Day 7 · Oct 4");
    assert.equal(shortRuleLabel({}), null);
    assert.equal(describeReleaseRule({}), "This lesson is available as soon as learners enroll.");
    assert.equal(describeReleaseRule({ dripDays: 1 }, "chapter"), "This chapter unlocks 1 day after a learner enrolls.");
    assert.equal(describeReleaseRule({ dripDays: 7, availableFrom: "2026-10-04" }), "This lesson unlocks 7 days after a learner enrolls, but not before Oct 4, 2026 (00:00 UTC).");
    assert.equal(formatUnlockLabel(NOW - 1, NOW), "Unlocking now");
    assert.equal(formatUnlockLabel(NOW + 30_000, NOW), "Unlocks in less than a minute");
    assert.equal(formatUnlockLabel(NOW + 12 * 60_000, NOW), "Unlocks in 12 minutes");
    assert.equal(formatUnlockLabel(NOW + 5 * 3_600_000, NOW), "Unlocks in 5 hours");
    assert.equal(formatUnlockLabel(NOW + 3 * DAY_MS, NOW), "Unlocks in 3 days");
    assert.match(formatUnlockLabel(NOW + 30 * DAY_MS, NOW), /^Unlocks on /);
    assert.deepEqual(countdownParts(DAY_MS + 3_723_000), { days: 1, hours: 1, minutes: 2, seconds: 3 });
    assert.deepEqual(countdownParts(-5), { days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("groups lessons by when they unlock", () => {
    const anchor = Date.UTC(2026, 0, 1);
    const groups = buildReleaseTimeline(
      [
        {
          id: "c1",
          title: "Week 1",
          lessons: [
            { id: "l1", title: "Intro", chapterNumber: 1, lessonNumber: 1, includeInPreview: false },
            { id: "l2", title: "Preview", chapterNumber: 1, lessonNumber: 2, includeInPreview: true, dripDays: 5 },
          ],
        },
        { id: "c2", title: "Week 2", dripDays: 7, lessons: [{ id: "l3", title: "Deep dive", chapterNumber: 2, lessonNumber: 1, includeInPreview: false, availableFrom: "2026-01-10" }] },
      ],
      anchor,
    );
    assert.deepEqual(groups.map((g) => [g.dayOffset, g.immediate, g.entries.map((e) => `${e.lessonId}:${e.source}`)]), [
      [0, true, ["l1:immediate", "l2:immediate"]],
      [9, false, ["l3:date"]],
    ]);
  });
});

describe("outline locking and lesson access (store)", () => {
  const learner = makeUser({ id: "usr_learner" });
  const teacher = makeUser({ id: "usr_teacher", roles: ["course_creator"] });
  const visitor = makeUser({ id: "usr_visitor" });
  const tree = makeCourseTree(
    [
      [{ id: "les_1", includeInPreview: true }, { id: "les_2" }],
      [{ id: "les_3" }, { id: "les_4", dripDays: 30 }],
    ],
    { course: { id: "crs_drip", enforceLessonCompletion: true, instructorIds: [teacher.id] } },
  );
  const now = Date.now();

  beforeEach(async () => {
    await resetDb({
      users: [learner, teacher, visitor],
      courses: [tree.course, makeCourse({ id: "crs_other" })],
      chapters: tree.chapters,
      lessons: tree.lessons,
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id, enrolledAt: new Date(now - DAY_MS).toISOString() })],
      progress: [makeProgress(tree.lessons[0]!, learner.id)],
      settings: { email: { enabled: false }, gamification: { enabled: false } },
    });
  });

  it("computes the learner's outline: order and drip locks", async () => {
    const outline = await getCourseOutline(tree.course, learner, now);
    const flat = outline.flatMap((c) => c.lessons);
    assert.deepEqual(flat.map((l) => [l.id, l.status, l.lock?.reason ?? null, `${l.chapterNumber}-${l.lessonNumber}`]), [
      ["les_1", "complete", null, "1-1"],
      ["les_2", "incomplete", null, "1-2"],
      ["les_3", "incomplete", "order", "2-1"],
      ["les_4", "incomplete", "drip", "2-2"],
    ]);
  });

  it("gives managers everything and visitors only the free preview", async () => {
    const managerView = (await getCourseOutline(tree.course, teacher, now)).flatMap((c) => c.lessons);
    assert.ok(managerView.every((l) => !l.locked));
    const visitorView = (await getCourseOutline(tree.course, visitor, now)).flatMap((c) => c.lessons);
    assert.deepEqual(visitorView.map((l) => l.locked), [false, true, true, true]);
  });

  it("authorises lesson actions with the same locks", async () => {
    assert.equal((await getLessonAccess(learner, "les_2"))?.canView, true);
    const ordered = await getLessonAccess(learner, "les_3");
    assert.equal(ordered?.canView, false);
    assert.equal(ordered?.lock?.reason, "order");
    assert.equal((await getLessonAccess(learner, "les_4"))?.lock?.reason, "drip");
    assert.equal((await getLessonAccess(null, "les_1"))?.canView, true);
    assert.equal((await getLessonAccess(null, "les_2"))?.canView, false);
    assert.equal((await getLessonAccess(teacher, "les_4"))?.canView, true);
    assert.equal(await getLessonAccess(learner, "les_missing"), null);
  });
});
