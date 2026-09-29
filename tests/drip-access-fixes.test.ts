import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, Program } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getCourseOutline, getNextLesson } from "@/lib/data/courses";
import { getAssessmentAccess } from "@/lib/data/lessons";
import { getStudentDashboard } from "@/lib/data/dashboard";
import { ensureDripNotifications } from "@/lib/services/drip";
import { enrollUserInBatch } from "@/lib/services/enrollment";
import { submitAssignmentAction } from "@/lib/actions/assignments";
import { updateCourseSettingsAction } from "@/lib/actions/courses";
import { addProgramCourseAction } from "@/lib/actions/programs";
import { formatUtcDateTime, pickContinueLesson, type ContinueCandidate } from "@/components/learn/drip-shared";
import {
  FIXED_NOW,
  makeBatch,
  makeCourse,
  makeCourseTree,
  makeEnrollment,
  makeProgress,
  makeQuiz,
  makeUser,
  resetDb,
} from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Drip review, minor findings 4–11 (finding 3 belongs to the media signing code). */

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const learner = makeUser({ id: "usr_learner" });
const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const creator = makeUser({ id: "usr_creator", roles: ["course_creator"] });

function makeAssignment(id: string): Assignment {
  return {
    id,
    title: `Assignment ${id}`,
    question: "Explain closures.",
    type: "text",
    showAnswer: false,
    gradeAssignment: true,
    enableScheduling: false,
    authorId: admin.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

async function login(userId: string) {
  resetRequest();
  await createSession(userId);
}

/* ------------------------------------------------------------------ */
/* 4. Standalone assignment / exercise access                           */
/* ------------------------------------------------------------------ */

describe("getAssessmentAccess (standalone assignment and exercise pages)", () => {
  const locked = makeAssignment("asg_locked");
  const shared = makeAssignment("asg_shared");
  const loose = makeAssignment("asg_loose");
  const tree = makeCourseTree(
    [
      [{ id: "les_open", blocks: [{ id: "a1", type: "assignment", assignmentId: shared.id }] }],
      [
        {
          id: "les_later",
          blocks: [
            { id: "a2", type: "assignment", assignmentId: locked.id },
            { id: "a3", type: "assignment", assignmentId: shared.id },
          ],
        },
      ],
    ],
    { course: { id: "crs_assess", slug: "assess" }, chapters: [{}, { dripDays: 10 }] },
  );

  beforeEach(async () => {
    await resetDb({
      users: [learner, admin, creator],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      assignments: [locked, shared, loose],
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id, enrolledAt: daysFromNow(-1) })],
    });
  });

  it("refuses an assignment that only lives in a drip-locked lesson", async () => {
    const access = await getAssessmentAccess(learner, "assignment", locked.id);
    assert.equal(access.ok, false);
    assert.match(access.ok ? "" : access.message, /not available yet/);
    assert.equal(access.ok ? null : access.courseHref, "/courses/assess");
  });

  it("allows staff, open placements, batch assessments and unplaced assignments", async () => {
    assert.equal((await getAssessmentAccess(creator, "assignment", locked.id)).ok, true);
    const viaOpen = await getAssessmentAccess(learner, "assignment", shared.id);
    assert.deepEqual(viaOpen, { ok: true, openLessonIds: ["les_open"] }, "only the open lesson may be named by a submission");
    assert.deepEqual(await getAssessmentAccess(learner, "assignment", loose.id), { ok: true, openLessonIds: [] });

    const db = await getDb();
    db.batches.push(makeBatch({ id: "bat_a", assessments: [{ id: "ba", type: "assignment", refId: locked.id }] }));
    db.batchEnrollments.push({ id: "ben_a", batchId: "bat_a", userId: learner.id, confirmationEmailSent: true, enrolledAt: FIXED_NOW });
    assert.equal((await getAssessmentAccess(learner, "assignment", locked.id)).ok, true);
  });

  it("rejects a submission to a locked assignment even without a lesson id", async () => {
    await login(learner.id);
    const form = new FormData();
    form.set("assignmentId", locked.id);
    form.set("answer", "A closure captures variables.");
    const result = await submitAssignmentAction(null, form);
    assert.equal(result.ok, false);
    assert.equal((await getDb()).assignmentSubmissions.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Joining a batch keeps an existing enrollment's drip anchor         */
/* ------------------------------------------------------------------ */

describe("enrollUserInBatch and existing enrollments", () => {
  const tree = makeCourseTree([[{ id: "les_first" }], [{ id: "les_week" }]], { course: { id: "crs_anchor", slug: "anchor" }, chapters: [{}, { dripDays: 7 }] });
  const other = makeCourse({ id: "crs_new", slug: "new-course" });
  const futureStart = daysFromNow(20).slice(0, 10);
  const batch = makeBatch({ id: "bat_future", courseIds: [tree.course.id, other.id], startDate: futureStart, startTime: "09:00", timezone: "UTC" });

  it("leaves a self-enrollment's schedule alone and anchors new batch enrollments on the batch start", async () => {
    await resetDb({
      users: [learner],
      courses: [tree.course, other],
      chapters: tree.chapters,
      lessons: tree.lessons,
      batches: [batch],
      enrollments: [makeEnrollment({ id: "enr_self", userId: learner.id, courseId: tree.course.id, enrolledAt: daysFromNow(-28) })],
      progress: [makeProgress(tree.lessons[1]!, learner.id, { status: "partial", completedAt: undefined })],
    });
    const before = (await getCourseOutline(tree.course, learner)).flatMap((c) => c.lessons).find((l) => l.id === "les_week");
    assert.equal(before?.locked, false);

    const joined = await enrollUserInBatch(learner.id, batch.id);
    assert.deepEqual(joined, { ok: true });
    const db = await getDb();
    assert.equal(db.enrollments.find((e) => e.id === "enr_self")?.batchId, undefined, "the existing enrollment keeps its own anchor");
    assert.equal(db.enrollments.find((e) => e.courseId === other.id)?.batchId, batch.id, "a course the batch enrolls them in counts from the batch start");

    const after = (await getCourseOutline(tree.course, learner)).flatMap((c) => c.lessons).find((l) => l.id === "les_week");
    assert.equal(after?.locked, false, "a released lesson does not relock after joining a batch that starts later");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Prerequisite cycles are rejected inside the serialized write       */
/* ------------------------------------------------------------------ */

describe("updateCourseSettingsAction prerequisites", () => {
  const a = makeCourse({ id: "crs_a", slug: "a", title: "Course A" });
  const b = makeCourse({ id: "crs_b", slug: "b", title: "Course B" });

  function settingsForm(courseId: string, prerequisiteId: string): FormData {
    const form = new FormData();
    form.set("courseId", courseId);
    form.set("selfEnrollment", "on");
    form.set("prerequisitesField", "1");
    form.append("prerequisiteCourseIds", prerequisiteId);
    return form;
  }

  it("never stores a cycle when two saves race", async () => {
    await resetDb({ users: [admin], courses: [a, b] });
    await login(admin.id);
    const results = await Promise.all([updateCourseSettingsAction(null, settingsForm(a.id, b.id)), updateCourseSettingsAction(null, settingsForm(b.id, a.id))]);
    assert.equal(results.filter((r) => r.ok).length, 1, "exactly one of the two saves wins");
    const failed = results.find((r) => !r.ok);
    assert.ok(failed && !failed.ok && failed.fieldErrors?.prerequisiteCourseIds);
    const db = await getDb();
    const aPrereqs = db.courses.find((c) => c.id === a.id)?.prerequisiteCourseIds ?? [];
    const bPrereqs = db.courses.find((c) => c.id === b.id)?.prerequisiteCourseIds ?? [];
    assert.ok(!(aPrereqs.includes(b.id) && bPrereqs.includes(a.id)), "A and B don't require each other");
  });
});

/* ------------------------------------------------------------------ */
/* 7. Adding a course to a program respects its prerequisites            */
/* ------------------------------------------------------------------ */

describe("addProgramCourseAction prerequisites", () => {
  const basics = makeCourse({ id: "crs_basics", slug: "basics", title: "Basics" });
  const advanced = makeCourse({ id: "crs_adv", slug: "advanced", title: "Advanced", prerequisiteCourseIds: [basics.id] });
  const ready = makeUser({ id: "usr_ready" });
  const program: Program = {
    id: "prg_path",
    slug: "path",
    title: "Path",
    published: true,
    enforceCourseOrder: false,
    courseIds: [basics.id],
    createdById: admin.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };

  it("enrolls only members who completed the prerequisites", async () => {
    await resetDb({
      users: [admin, learner, ready],
      courses: [basics, advanced],
      programs: [program],
      programMembers: [
        { id: "pm_1", programId: program.id, userId: learner.id, progress: 0, joinedAt: FIXED_NOW },
        { id: "pm_2", programId: program.id, userId: ready.id, progress: 0, joinedAt: FIXED_NOW },
      ],
      enrollments: [
        makeEnrollment({ userId: learner.id, courseId: basics.id, progress: 10 }),
        makeEnrollment({ userId: ready.id, courseId: basics.id, progress: 100, completedAt: FIXED_NOW }),
      ],
    });
    await login(admin.id);
    const result = await addProgramCourseAction(program.id, advanced.id);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.match(result.message ?? "", /One member can start it once they complete its prerequisites/);
    const db = await getDb();
    assert.equal(db.enrollments.some((e) => e.userId === learner.id && e.courseId === advanced.id), false);
    assert.equal(db.enrollments.some((e) => e.userId === ready.id && e.courseId === advanced.id), true);
  });
});

/* ------------------------------------------------------------------ */
/* 8, 9, 11. Enforced order, notifications, pending work, "up next"      */
/* ------------------------------------------------------------------ */

describe("scheduled content for a learner who is behind or caught up", () => {
  const quizLater = makeQuiz({ id: "quiz_later", title: "Secret scheduled quiz" });
  const quizNow = makeQuiz({ id: "quiz_now", title: "Current quiz" });
  const tree = makeCourseTree(
    [
      [{ id: "les_1_1", blocks: [{ id: "q1", type: "quiz", quizId: quizNow.id }] }, { id: "les_1_2" }],
      [{ id: "les_2_1", blocks: [{ id: "q2", type: "quiz", quizId: quizLater.id }] }, { id: "les_2_2" }],
    ],
    { course: { id: "crs_order", slug: "order", enforceLessonCompletion: true }, chapters: [{}, { dripDays: 3 }] },
  );

  async function seedCourse(done: string[], enrolledDaysAgo: number) {
    await resetDb({
      users: [learner],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      quizzes: [quizLater, quizNow],
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id, enrolledAt: daysFromNow(-enrolledDaysAgo), currentLessonId: done.at(-1) })],
      progress: tree.lessons.filter((l) => done.includes(l.id)).map((l) => makeProgress(l, learner.id)),
    });
  }

  it("announces a released chapter only once its first lesson is open in order", async () => {
    // Enrolled 4 days ago: chapter 2 was released a day ago, but lesson 1.2 is not done yet.
    await seedCourse(["les_1_1"], 4);
    assert.equal(await ensureDripNotifications(learner.id), 0, "nothing the learner can open yet");
    assert.equal((await getDb()).notifications.length, 0);

    const db = await getDb();
    db.progress.push(makeProgress(tree.lessons[1]!, learner.id));
    assert.equal(await ensureDripNotifications(learner.id), 1);
    const [notice] = (await getDb()).notifications;
    assert.equal(notice?.dedupeKey, `drip:${tree.chapters[1]!.id}`);
    assert.match(notice?.message ?? "", /1 lesson is now available/);
    assert.equal(notice?.link, "/courses/order/learn/2-1");
  });

  it("leaves assessments of locked lessons out of the dashboard's pending work", async () => {
    await seedCourse([], 1);
    const dashboard = await getStudentDashboard(learner, (await getDb()).settings);
    const titles = dashboard.pending.items.map((i) => i.title);
    assert.ok(titles.includes("Current quiz"));
    assert.ok(!titles.includes("Secret scheduled quiz"), "scheduled work stays hidden");
  });

  it("reports the scheduled state instead of a finished lesson as up next", async () => {
    await seedCourse(["les_1_1", "les_1_2"], 1);
    assert.equal(await getNextLesson(tree.course, learner), null, "caught up: the next lesson is scheduled");

    await seedCourse(["les_1_1"], 1);
    assert.equal((await getNextLesson(tree.course, learner))?.id, "les_1_2");

    await seedCourse(tree.lessons.map((l) => l.id), 1);
    assert.equal((await getNextLesson(tree.course, learner))?.id, "les_1_1", "a finished course offers the first lesson for review");
  });
});

describe("pickContinueLesson", () => {
  const row = (id: string, status: ContinueCandidate["status"], lock: ContinueCandidate["lock"] = null): ContinueCandidate => ({ id, status, locked: !!lock, lock });
  const drip = { reason: "drip" as const, unlocksAt: "2026-10-02T12:00:00.000Z" };

  it("prefers the current lesson, then the first open incomplete one", () => {
    const rows = [row("a", "complete"), row("b", "partial"), row("c", "incomplete")];
    assert.equal(pickContinueLesson(rows, "c")?.id, "c");
    assert.equal(pickContinueLesson(rows, "a")?.id, "b");
    assert.equal(pickContinueLesson(rows)?.id, "b");
  });

  it("returns null when everything open is done and more is scheduled", () => {
    assert.equal(pickContinueLesson([row("a", "complete"), row("b", "incomplete", drip), row("c", "incomplete", { reason: "order" })], "a"), null);
  });

  it("never returns a locked lesson", () => {
    assert.equal(pickContinueLesson([row("a", "incomplete", { reason: "enroll" })]), null);
    assert.equal(pickContinueLesson([row("a", "complete"), row("b", "complete")])?.id, "a");
    assert.equal(pickContinueLesson([]), null);
  });
});

/* ------------------------------------------------------------------ */
/* 10. Countdown fallback shows the real UTC time                        */
/* ------------------------------------------------------------------ */

describe("formatUtcDateTime", () => {
  it("shows the exact UTC release time of day-based unlocks", () => {
    assert.equal(formatUtcDateTime(Date.parse("2026-10-02T12:00:00Z")), "Oct 2, 2026 at 12:00 UTC");
    assert.equal(formatUtcDateTime(Date.parse("2026-12-31T23:59:30Z")), "Dec 31, 2026 at 23:59 UTC");
    assert.equal(formatUtcDateTime(Number.NaN), "");
  });
});
