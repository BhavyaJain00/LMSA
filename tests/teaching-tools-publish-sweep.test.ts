import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@/lib/types";
import { runPublishSweep, coursePublishedKey } from "@/lib/teaching/publish-sweep";
import { isPublishedNow, publishSweepSettled } from "@/lib/teaching/scheduling";
import { canViewCourse, computeViewerLessons, getCourseSummaries } from "@/lib/data/courses";
import { getCourseScheduleAction, scheduleCoursePublishAction, scheduleLessonPublishAction } from "@/lib/actions/course-tools";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const HOUR = 3_600_000;
/** Times relative to the real clock: the lazily queued sweep runs with `Date.now()`. */
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

const moderator = makeUser({ id: "usr_mod", roles: ["student", "moderator"] });
const instructor = makeUser({ id: "usr_ins", roles: ["student", "course_creator"] });
const learner = makeUser({ id: "usr_learn" });
const member = makeUser({ id: "usr_member" });
const users: User[] = [moderator, instructor, learner, member];

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

afterEach(async () => {
  await publishSweepSettled();
});

describe("teaching-tools publish sweep: scheduled courses", () => {
  const tree = makeCourseTree([[{}, {}]], { course: { id: "crs_sched", slug: "sched", title: "Scheduled", published: false, status: "approved", instructorIds: [instructor.id] } });

  beforeEach(async () => {
    await resetDb({ users, courses: [{ ...tree.course, publishAt: iso(-HOUR) }], chapters: tree.chapters, lessons: tree.lessons, settings: { email: { enabled: false } } });
  });

  it("shows a course whose time has passed before the sweep has run", async () => {
    const course = (await getDb()).courses[0]!;
    assert.equal(course.published, false);
    assert.equal(isPublishedNow(course), true);
    assert.equal(canViewCourse(learner, course), true);
    const list = await getCourseSummaries(learner, { tab: "live" });
    assert.deepEqual(
      list.map((c) => c.id),
      [tree.course.id],
    );
    // The visibility check queued the sweep, which wrote the flag down.
    await publishSweepSettled();
    const after = (await getDb()).courses[0]!;
    assert.equal(after.published, true);
    assert.equal(after.publishAt, undefined);
  });

  it("publishes with its side effects exactly once", async () => {
    const first = await runPublishSweep();
    assert.deepEqual(
      first.published.map((c) => [c.id, c.firstPublish]),
      [[tree.course.id, true]],
    );
    const db = await getDb();
    const course = db.courses[0]!;
    assert.equal(course.published, true);
    assert.ok(course.publishedOn);
    const notes = db.notifications.filter((n) => n.dedupeKey === coursePublishedKey(course.id));
    // Members (learner, member, moderator) hear about the new course; the instructor gets the "now live" note.
    assert.deepEqual(notes.map((n) => n.userId).sort(), [instructor.id, learner.id, member.id, moderator.id].sort());
    assert.equal(db.auditEvents.filter((a) => a.action === "course.publish" && a.targetId === course.id).length, 1);

    const second = await runPublishSweep();
    assert.deepEqual(second, { published: [], released: [], notifications: 0 });
    const again = await getDb();
    assert.equal(again.notifications.filter((n) => n.dedupeKey === coursePublishedKey(course.id)).length, notes.length);
    assert.equal(again.auditEvents.filter((a) => a.action === "course.publish").length, 1);
  });

  it("two sweeps at the same time publish once", async () => {
    const [a, b] = await Promise.all([runPublishSweep(), runPublishSweep()]);
    assert.equal(a.published.length + b.published.length, 1);
    const db = await getDb();
    assert.equal(db.notifications.filter((n) => n.dedupeKey === coursePublishedKey(tree.course.id) && n.userId === learner.id).length, 1);
  });

  it("keeps a course that is not approved hidden", async () => {
    await resetDb({ users, courses: [{ ...tree.course, status: "under_review", publishAt: iso(-HOUR) }], chapters: tree.chapters, lessons: tree.lessons });
    const course = (await getDb()).courses[0]!;
    assert.equal(isPublishedNow(course), false);
    assert.equal((await runPublishSweep()).published.length, 0);
  });
});

describe("teaching-tools publish sweep: scheduled lessons", () => {
  const tree = makeCourseTree([[{ id: "les_a" }, { id: "les_b" }, { id: "les_c" }]], { course: { id: "crs_live", slug: "live", instructorIds: [instructor.id] } });

  async function load(publishAt: string) {
    await resetDb({
      users,
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons.map((l) => (l.id === "les_b" ? { ...l, publishAt } : l)),
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
      settings: { email: { enabled: false } },
    });
  }

  it("hides a scheduled lesson from learners but keeps lesson numbers stable", async () => {
    await load(iso(5 * HOUR));
    const db = await getDb();
    const forLearner = computeViewerLessons(db, db.courses[0]!, learner, Date.now()).lessons;
    assert.deepEqual(
      forLearner.map((r) => [r.lesson.id, r.li + 1]),
      [
        ["les_a", 1],
        ["les_c", 3],
      ],
    );
    const forInstructor = computeViewerLessons(db, db.courses[0]!, instructor, Date.now()).lessons;
    assert.equal(forInstructor.length, 3);
  });

  it("releases a lesson and tells enrolled learners once", async () => {
    await load(iso(-HOUR));
    const db = await getDb();
    assert.equal(computeViewerLessons(db, db.courses[0]!, learner, Date.now()).lessons.length, 3);
    // The check queues a sweep (unless one finished moments ago); either way one more sweep must change nothing twice.
    await publishSweepSettled();
    await runPublishSweep();
    const after = await getDb();
    assert.equal(after.lessons.find((l) => l.id === "les_b")!.publishAt, undefined);
    const notes = after.notifications.filter((n) => n.userId === learner.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.link, "/courses/live/learn/1-2");
    assert.equal((await runPublishSweep()).notifications, 0);
  });

  it("schedules a lesson and publishes it on demand", async () => {
    await load(iso(5 * HOUR));
    await signIn(instructor.id);
    assert.equal((await scheduleLessonPublishAction("les_a", iso(-HOUR))).ok, false, "a past time is refused");
    const scheduled = await scheduleLessonPublishAction("les_c", iso(2 * HOUR));
    assert.ok(scheduled.ok);
    assert.equal(scheduled.data.hidden, true);
    const now = await scheduleLessonPublishAction("les_b", null);
    assert.ok(now.ok);
    assert.equal(now.data.hidden, false);
    const db = await getDb();
    assert.equal(db.lessons.find((l) => l.id === "les_b")!.publishAt, undefined);
    assert.equal(db.notifications.filter((n) => n.userId === learner.id).length, 1);

    await signIn(learner.id);
    assert.equal((await scheduleLessonPublishAction("les_c", null)).ok, false);
  });
});

describe("teaching-tools publish sweep: schedule actions", () => {
  const tree = makeCourseTree([[{}]], { course: { id: "crs_draft", slug: "draft", published: false, status: "in_progress", instructorIds: [instructor.id] } });

  beforeEach(async () => {
    await resetDb({ users, courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons, settings: { email: { enabled: false } } });
  });

  it("lets a moderator schedule and cancel, and an unapproved instructor only view", async () => {
    await signIn(instructor.id);
    const view = await getCourseScheduleAction(tree.course.id);
    assert.ok(view.ok);
    assert.equal(view.data.canSchedule, false);
    assert.equal((await scheduleCoursePublishAction(tree.course.id, iso(2 * HOUR))).ok, false);

    await signIn(moderator.id);
    const res = await scheduleCoursePublishAction(tree.course.id, iso(2 * HOUR));
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(res.data.state, "scheduled");
    let db = await getDb();
    assert.equal(db.courses[0]!.status, "approved");
    assert.ok(db.courses[0]!.publishAt);
    assert.equal(isPublishedNow(db.courses[0]!), false);
    assert.ok(db.auditEvents.some((a) => a.action === "course.schedule"));

    const cancelled = await scheduleCoursePublishAction(tree.course.id, null);
    assert.ok(cancelled.ok);
    db = await getDb();
    assert.equal(db.courses[0]!.publishAt, undefined);
    assert.equal(db.courses[0]!.published, false);
  });
});
