import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, AssignmentSubmission, Rubric } from "@/lib/types";
import {
  addPeerReviewerAction,
  allocatePeerReviewsNowAction,
  overridePeerReviewAction,
  reassignPeerReviewAction,
  remindPendingReviewersAction,
  removePeerReviewAction,
  saveAssignmentReviewSettingsAction,
  submitPeerReviewAction,
} from "@/lib/actions/peer-reviews";
import { createSession } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import {
  completeLessonsAfterPeerReview,
  getPeerAssignmentOverview,
  getPeerFeedback,
  getReviewerTask,
  getSubmissionPeerPanel,
  listPeerReviewAssignments,
  listReceivedFeedback,
  listReviewerQueue,
  peerReviewsCsv,
  sendPeerReviewReminders,
  syncPeerAssignments,
} from "@/lib/teaching/peer-review";
import { ANONYMOUS_AUTHOR_LABEL, activePeerConfig, type PeerConfig, type PeerReviewRecord } from "@/lib/teaching/peer-shared";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Peer review end to end through the store: allocation, the review form, anonymity, instructor overrides, reminders. */

const DAY = 86_400_000;

const teacher = makeUser({ id: "usr_teacher", name: "Tara Teacher", roles: ["course_creator"] });
const students = ["Ana", "Ben", "Cleo", "Dev", "Eli"].map((name, i) => makeUser({ id: `usr_s${i + 1}`, name: `${name} Student` }));
const [ana, ben, cleo, dev, eli] = students as [typeof teacher, typeof teacher, typeof teacher, typeof teacher, typeof teacher];

const rubric: Rubric = {
  id: "rub_essay",
  title: "Essay rubric",
  passPercent: 60,
  criteria: [
    { id: "crit_idea", title: "Ideas", levels: [{ label: "Thin", points: 1 }, { label: "Solid", points: 3 }, { label: "Rich", points: 5 }] },
    { id: "crit_style", title: "Style", levels: [{ label: "Rough", points: 0 }, { label: "Clean", points: 5 }] },
  ],
  createdById: teacher.id,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const tree = makeCourseTree([[{ id: "les_essay", blocks: [{ id: "blk_asg", type: "assignment", assignmentId: "asg_essay" }] }]], { course: { id: "crs_writing", slug: "writing" } });
const lesson = tree.lessons[0]!;

function makeAssignment(overrides: Partial<Assignment> & { peer?: Partial<PeerConfig> } = {}): Assignment {
  const { peer, ...rest } = overrides;
  return {
    id: "asg_essay",
    title: "Reflective essay",
    question: "Write 300 words about what you learned.",
    type: "text",
    showAnswer: false,
    gradeAssignment: true,
    courseId: tree.course.id,
    enableScheduling: false,
    rubricId: rubric.id,
    peerReview: { enabled: true, reviewsPerSubmission: 2, dueDays: 5, anonymous: true, ...peer } as PeerConfig,
    authorId: teacher.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...rest,
  };
}

function makeSubmission(userId: string, overrides: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
  const at = new Date(Date.now() - 3 * DAY).toISOString();
  return {
    id: `asub_${userId.slice(4)}`,
    assignmentId: "asg_essay",
    assignmentTitle: "Reflective essay",
    userId,
    courseId: tree.course.id,
    lessonId: lesson.id,
    type: "text",
    answer: `Essay by ${userId}`,
    status: "not_graded",
    submittedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function baseFixture(overrides: Fixture = {}): Fixture {
  return {
    users: [teacher, ...students],
    courses: [tree.course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: students.map((s) => makeEnrollment({ userId: s.id, courseId: tree.course.id })),
    rubrics: [rubric],
    assignments: [makeAssignment()],
    assignmentSubmissions: students.slice(0, 4).map((s) => makeSubmission(s.id)),
    settings: { email: { enabled: false } },
    ...overrides,
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

const fullMarks = JSON.stringify([
  { criterionId: "crit_idea", levelIndex: 2, comment: "Original angle." },
  { criterionId: "crit_style", levelIndex: 1 },
]);
const FEEDBACK = "Clear structure and a strong ending; add one concrete example.";

async function reviewsOf(reviewerId: string): Promise<PeerReviewRecord[]> {
  return (await getDb()).peerReviews.filter((r) => r.reviewerId === reviewerId) as PeerReviewRecord[];
}

describe("handing out peer reviews", () => {
  beforeEach(async () => {
    await resetDb(baseFixture());
  });

  it("gives every submitter two classmates to review, never themselves, and tells them once", async () => {
    assert.equal(await syncPeerAssignments(), 8);
    const db = await getDb();
    const authorOf = new Map(db.assignmentSubmissions.map((s) => [s.id, s.userId]));
    for (const s of students.slice(0, 4)) {
      const given = db.peerReviews.filter((r) => r.reviewerId === s.id);
      assert.equal(given.length, 2);
      assert.ok(given.every((r) => authorOf.get(r.submissionId) !== s.id));
      assert.equal(db.peerReviews.filter((r) => authorOf.get(r.submissionId) === s.id).length, 2);
      assert.equal(db.notifications.filter((n) => n.userId === s.id && n.dedupeKey?.startsWith("peer-assigned:")).length, 1, "one notification for both reviews");
    }
    assert.ok(db.peerReviews.every((r) => r.status === "assigned" && r.comment === ""));
    assert.equal(db.peerReviews.filter((r) => r.reviewerId === eli.id).length, 0, "Eli has not submitted");

    assert.equal(await syncPeerAssignments(), 0, "a second pass creates nothing");
    assert.equal((await getDb()).peerReviews.length, 8);
  });

  it("brings a late submitter in without touching existing reviews", async () => {
    await syncPeerAssignments();
    const before = (await getDb()).peerReviews.map((r) => r.id);
    await mutate((db) => {
      db.assignmentSubmissions.push(makeSubmission(eli.id, { submittedAt: new Date().toISOString() }));
    });
    // Everyone else is fully reviewed and has a full load: the newcomer waits for the next classmate
    // instead of piling a third review onto earlier work.
    assert.equal(await syncPeerAssignments(), 0);
    // Nobody else turned up: after the overflow wait the newcomer is brought in anyway, both ways.
    assert.equal(await syncPeerAssignments({ now: Date.now() + 2 * DAY + 60_000 }), 4);
    const db = await getDb();
    assert.deepEqual(db.peerReviews.slice(0, 8).map((r) => r.id), before);
    assert.equal(db.peerReviews.filter((r) => r.reviewerId === eli.id).length, 2, "the newcomer has reviews to write");
    assert.equal(db.peerReviews.filter((r) => r.submissionId === "asub_s5").length, 2, "and is reviewed twice");
    assert.ok(db.peerReviews.every((r) => r.reviewerId !== eli.id || r.submissionId !== "asub_s5"));
  });

  it("leaves out staff and disabled accounts", async () => {
    await resetDb(
      baseFixture({
        users: [teacher, ana, ben, { ...cleo, enabled: false }],
        assignmentSubmissions: [makeSubmission(ana.id), makeSubmission(ben.id), makeSubmission(cleo.id), makeSubmission(teacher.id)],
      }),
    );
    assert.equal(await syncPeerAssignments(), 2);
    const db = await getDb();
    assert.deepEqual(db.peerReviews.map((r) => r.reviewerId).sort(), [ana.id, ben.id]);
    assert.ok(db.peerReviews.every((r) => ["asub_s1", "asub_s2"].includes(r.submissionId)));
  });

  it("waits for the submission deadline when the assignment has one", async () => {
    const end = Date.now() + 2 * DAY;
    await resetDb(baseFixture({ assignments: [makeAssignment({ enableScheduling: true, scheduleStart: FIXED_NOW, scheduleEnd: new Date(end).toISOString() })] }));
    assert.equal(await syncPeerAssignments(), 0);
    assert.equal((await listPeerReviewAssignments())[0]!.open, false);
    assert.equal(await syncPeerAssignments({ now: end + 1000 }), 8);
    const db = await getDb();
    assert.ok(db.peerReviews.every((r) => r.assignedAt === new Date(end + 1000).toISOString()), "the review period starts at the deadline");
  });

  it("lets an instructor hand reviews out before the deadline", async () => {
    await resetDb(baseFixture({ assignments: [makeAssignment({ enableScheduling: true, scheduleStart: FIXED_NOW, scheduleEnd: new Date(Date.now() + 2 * DAY).toISOString() })] }));
    await signIn(ana.id);
    assert.equal((await allocatePeerReviewsNowAction("asg_essay")).ok, false, "learners cannot allocate");
    await signIn(teacher.id);
    const res = await allocatePeerReviewsNowAction("asg_essay");
    assert.ok(res.ok);
    assert.equal(res.data.created, 8);
    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "peer_review.allocate" && e.targetId === "asg_essay"));
    const again = await allocatePeerReviewsNowAction("asg_essay");
    assert.ok(again.ok);
    assert.equal(again.data.created, 0);
  });

  it("drops reviews whose submission was deleted", async () => {
    await syncPeerAssignments();
    await mutate((db) => {
      db.assignmentSubmissions = db.assignmentSubmissions.filter((s) => s.userId !== dev.id);
    });
    await syncPeerAssignments();
    const db = await getDb();
    assert.ok(db.peerReviews.every((r) => r.submissionId !== "asub_s4"));
    assert.ok(db.peerReviews.length > 0);
  });
});

describe("review settings on the assignment", () => {
  beforeEach(async () => {
    await resetDb(baseFixture({ assignments: [makeAssignment({ rubricId: undefined, peerReview: undefined })] }));
  });

  const settings = (fields: Record<string, string> = {}) =>
    form({ assignmentId: "asg_essay", rubricId: rubric.id, peerEnabled: "on", reviewsPerSubmission: "2", dueDays: "4", anonymous: "on", ...fields });

  it("is for staff only and validates the numbers", async () => {
    await signIn(ana.id);
    assert.equal((await saveAssignmentReviewSettingsAction(null, settings())).ok, false);
    await signIn(teacher.id);
    const bad = await saveAssignmentReviewSettingsAction(null, settings({ reviewsPerSubmission: "9", dueDays: "0", rubricId: "rub_missing" }));
    assert.ok(!bad.ok);
    assert.ok(bad.fieldErrors?.reviewsPerSubmission);
    assert.ok(bad.fieldErrors?.dueDays);
    assert.ok(bad.fieldErrors?.rubricId);
    assert.equal((await getDb()).assignments[0]!.peerReview, undefined);
  });

  it("saves the rubric and peer settings and hands out reviews for existing submissions", async () => {
    await signIn(teacher.id);
    const res = await saveAssignmentReviewSettingsAction(null, settings());
    assert.ok(res.ok);
    assert.equal(res.data.assigned, 8);
    const db = await getDb();
    const saved = db.assignments[0]!;
    assert.equal(saved.rubricId, rubric.id);
    assert.deepEqual(activePeerConfig(saved), { enabled: true, reviewsPerSubmission: 2, dueDays: 4, anonymous: true, requiredForCompletion: false });
    assert.ok(db.auditEvents.some((e) => e.action === "assignment.review_settings"));

    // Turning peer review off keeps the numbers for next time and the reviews already written.
    const off = await saveAssignmentReviewSettingsAction(null, form({ assignmentId: "asg_essay", rubricId: "" }));
    assert.ok(off.ok);
    const after = (await getDb()).assignments[0]!;
    assert.equal(after.rubricId, undefined);
    assert.equal(after.peerReview?.enabled, false);
    assert.equal(after.peerReview?.dueDays, 4);
    assert.equal((await getDb()).peerReviews.length, 8);
    assert.equal(await listReviewerQueue(ana.id).then((rows) => rows.length), 0, "reviews of a switched-off assignment are hidden");
  });
});

describe("writing a review", () => {
  beforeEach(async () => {
    await resetDb(baseFixture());
    await syncPeerAssignments();
  });

  it("only lets the assigned reviewer submit, with every criterion rated and real feedback", async () => {
    const [mine] = await reviewsOf(ana.id);
    await signIn(ben.id);
    assert.equal((await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: FEEDBACK }))).ok, false);

    await signIn(ana.id);
    const partial = await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: JSON.stringify([{ criterionId: "crit_idea", levelIndex: 1 }]), comment: "Too short" }));
    assert.ok(!partial.ok);
    assert.ok(partial.fieldErrors?.rubric);
    assert.ok(partial.fieldErrors?.comment);
    assert.equal((await reviewsOf(ana.id))[0]!.status, "assigned");

    const res = await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: `  ${FEEDBACK}\r\n` }));
    assert.ok(res.ok);
    const saved = (await reviewsOf(ana.id)).find((r) => r.id === mine!.id)!;
    assert.equal(saved.status, "submitted");
    assert.equal(saved.comment, FEEDBACK);
    assert.ok(saved.submittedAt);
    assert.deepEqual(saved.scores, [
      { criterionId: "crit_idea", levelIndex: 2, points: 5, comment: "Original angle." },
      { criterionId: "crit_style", levelIndex: 1, points: 5 },
    ]);
  });

  it("takes points from the rubric, not from the form", async () => {
    const [mine] = await reviewsOf(ana.id);
    await signIn(ana.id);
    const forged = JSON.stringify([
      { criterionId: "crit_idea", levelIndex: 0, points: 500 },
      { criterionId: "crit_style", levelIndex: 0, points: 500 },
    ]);
    assert.ok((await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: forged, comment: FEEDBACK }))).ok);
    const saved = (await reviewsOf(ana.id)).find((r) => r.id === mine!.id)!;
    assert.deepEqual(saved.scores!.map((s) => s.points), [1, 0]);
  });

  it("notifies the author once and lets the reviewer revise until the work is graded", async () => {
    const [mine] = await reviewsOf(ana.id);
    const db0 = await getDb();
    const authorId = db0.assignmentSubmissions.find((s) => s.id === mine!.submissionId)!.userId;
    await signIn(ana.id);
    assert.ok((await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: FEEDBACK }))).ok);
    const revised = await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: `${FEEDBACK} Revised.` }));
    assert.ok(revised.ok);
    assert.equal(revised.message, "Review updated");
    let db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === authorId && n.dedupeKey === `peer-received:${mine!.id}`).length, 1);

    await mutate((d) => {
      d.assignmentSubmissions.find((s) => s.id === mine!.submissionId)!.status = "pass";
    });
    const late = await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: `${FEEDBACK} Again.` }));
    assert.equal(late.ok, false);
    db = await getDb();
    assert.equal(db.peerReviews.find((r) => r.id === mine!.id)!.comment, `${FEEDBACK} Revised.`);
    const task = await getReviewerTask(mine!.id, ana.id);
    assert.equal(task!.locked, true);
  });

  it("needs only written feedback when the assignment has no rubric", async () => {
    await resetDb(baseFixture({ assignments: [makeAssignment({ rubricId: undefined })] }));
    await syncPeerAssignments();
    const [mine] = await reviewsOf(ben.id);
    await signIn(ben.id);
    assert.ok((await submitPeerReviewAction(null, form({ reviewId: mine!.id, comment: FEEDBACK }))).ok);
    const saved = (await reviewsOf(ben.id)).find((r) => r.id === mine!.id)!;
    assert.equal(saved.scores, undefined);
    assert.equal(saved.status, "submitted");
  });
});

describe("what each side sees", () => {
  beforeEach(async () => {
    await resetDb(baseFixture());
    await syncPeerAssignments();
  });

  it("lists a learner's reviews with due dates, open ones first", async () => {
    const now = Date.now();
    const rows = await listReviewerQueue(ana.id, now);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.status === "assigned" && r.usesRubric && r.anonymous && r.courseTitle === tree.course.title));
    assert.equal(rows[0]!.dueAt, new Date(new Date(rows[0]!.assignedAt).getTime() + 5 * DAY).toISOString());
    assert.equal(rows[0]!.overdue, false);
    assert.ok((await listReviewerQueue(ana.id, now + 6 * DAY)).every((r) => r.overdue));
    assert.equal(await getReviewerTask(rows[0]!.id, ben.id), null, "someone else's review is not readable");
  });

  it("hides names in anonymous mode and shows them otherwise", async () => {
    const [mine] = await reviewsOf(ana.id);
    const task = await getReviewerTask(mine!.id, ana.id);
    assert.equal(task!.authorLabel, ANONYMOUS_AUTHOR_LABEL);
    assert.equal(task!.rubric?.id, rubric.id);
    assert.ok(task!.submission.answer?.startsWith("Essay by"));

    await signIn(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: FEEDBACK }));
    const db = await getDb();
    const authorId = db.assignmentSubmissions.find((s) => s.id === mine!.submissionId)!.userId;
    const feedback = await getPeerFeedback(authorId, "asg_essay", rubric);
    assert.equal(feedback!.received.length, 1);
    assert.match(feedback!.received[0]!.label, /^Peer reviewer [12]$/);
    assert.equal(feedback!.received[0]!.total, 10);
    assert.equal(feedback!.assignedOnMine, 2);
    assert.equal(feedback!.average?.total, 10);
    const serialized = JSON.stringify(feedback);
    assert.ok(!serialized.includes(ana.id) && !serialized.includes(ana.name), "nothing identifies the reviewer");

    await mutate((d) => {
      (d.assignments[0]!.peerReview as PeerConfig).anonymous = false;
    });
    assert.equal((await getPeerFeedback(authorId, "asg_essay", rubric))!.received[0]!.label, ana.name);
    assert.equal((await getReviewerTask(mine!.id, ana.id))!.authorLabel, db.users.find((u) => u.id === authorId)!.name);
  });

  it("shows a learner only the reviews that were submitted, plus what they still owe", async () => {
    const feedback = await getPeerFeedback(ben.id, "asg_essay", rubric);
    assert.equal(feedback!.submitted, true);
    assert.deepEqual(feedback!.received, []);
    assert.equal(feedback!.average, null);
    assert.equal(feedback!.toGive.pending, 2);
    assert.ok(feedback!.toGive.nextReviewId);
    const outsider = await getPeerFeedback(eli.id, "asg_essay", rubric);
    assert.equal(outsider!.submitted, false);
    assert.equal(outsider!.toGive.pending, 0);
  });

  it("collects the feedback a learner received across assignments", async () => {
    const [mine] = await reviewsOf(ana.id);
    const authorId = (await getDb()).assignmentSubmissions.find((s) => s.id === mine!.submissionId)!.userId;
    let rows = await listReceivedFeedback(authorId);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { expected: rows[0]!.expected, received: rows[0]!.received, averagePercent: rows[0]!.averagePercent, lastReceivedAt: rows[0]!.lastReceivedAt },
      { expected: 2, received: 0, averagePercent: null, lastReceivedAt: null },
    );
    assert.equal(rows[0]!.href, `/assignments/asg_essay?lesson=${lesson.id}&course=${tree.course.id}`);

    await signIn(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: JSON.stringify([{ criterionId: "crit_idea", levelIndex: 1 }, { criterionId: "crit_style", levelIndex: 1 }]), comment: FEEDBACK }));
    rows = await listReceivedFeedback(authorId);
    assert.equal(rows[0]!.received, 1);
    assert.equal(rows[0]!.averagePercent, 80);
    assert.ok(rows[0]!.lastReceivedAt);
    assert.deepEqual(await listReceivedFeedback(eli.id), [], "nothing submitted, nothing to receive");
  });

  it("gives instructors every review with real names, coverage per learner and a CSV", async () => {
    const [mine] = await reviewsOf(ana.id);
    await signIn(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: 'Says "hello", twice' + " and enough text." }));

    const overview = await getPeerAssignmentOverview("asg_essay");
    assert.equal(overview!.rows.length, 8);
    assert.deepEqual(overview!.stats, { submissions: 4, assigned: 8, completed: 1, overdue: 0, unreviewed: 0 });
    assert.ok(overview!.rows.every((r) => r.author.name.endsWith("Student") && r.reviewer.name.endsWith("Student")));
    const anaRow = overview!.coverage.find((c) => c.author.id === ana.id)!;
    assert.deepEqual(anaRow.given, { assigned: 2, submitted: 1, overdue: 0 });
    assert.deepEqual(anaRow.received, { assigned: 2, submitted: 0 });
    assert.equal(anaRow.reviewerIds.length, 2);

    assert.equal((await getPeerAssignmentOverview("asg_essay", { status: "submitted" }))!.rows.length, 1);
    assert.equal((await getPeerAssignmentOverview("asg_essay", { status: "assigned" }))!.rows.length, 7);
    assert.equal((await getPeerAssignmentOverview("asg_essay", { search: "ana" }))!.rows.length, 4, "as author or as reviewer");
    assert.equal((await getPeerAssignmentOverview("asg_essay", { coverage: "owing" }))!.coverage.length, 4);
    assert.equal((await getPeerAssignmentOverview("asg_essay", { coverage: "unreviewed" }))!.coverage.length, 0);
    assert.equal((await getPeerAssignmentOverview("asg_essay", {}, Date.now() + 6 * DAY))!.stats.overdue, 7);

    const panel = await getSubmissionPeerPanel(mine!.submissionId);
    assert.equal(panel!.reviews.length, 2);
    assert.equal(panel!.average?.count, 1);
    assert.equal(panel!.reviewerOptions.length, 4);

    const list = await listPeerReviewAssignments({ state: "in_progress" });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.completed, 1);
    assert.equal((await listPeerReviewAssignments({ state: "done" })).length, 0);
    assert.equal((await listPeerReviewAssignments({ search: "nothing like it" })).length, 0);

    const csv = await peerReviewsCsv("asg_essay");
    const lines = csv!.split("\r\n");
    assert.equal(lines.length, 9);
    assert.ok(lines[0]!.includes("Ideas,Style,Total,Max,Percent,Comment"));
    const submitted = lines.slice(1).find((l) => l.includes(",Submitted,"))!;
    assert.ok(submitted.includes(",5,5,10,10,100,"));
    assert.ok(submitted.includes('"Says ""hello"", twice and enough text."'), "quotes and commas are escaped");
    assert.equal(await peerReviewsCsv("asg_missing"), null);
  });
});

describe("instructor controls", () => {
  beforeEach(async () => {
    await resetDb(baseFixture());
    await syncPeerAssignments();
  });

  it("overrides a review, which then belongs to the instructor", async () => {
    const [target] = await reviewsOf(ana.id);
    await signIn(ben.id);
    assert.equal((await overridePeerReviewAction(null, form({ reviewId: target!.id, selections: fullMarks, comment: "Edited" }))).ok, false);

    await signIn(teacher.id);
    const incomplete = await overridePeerReviewAction(null, form({ reviewId: target!.id, selections: "[]", comment: "" }));
    assert.ok(!incomplete.ok);
    const res = await overridePeerReviewAction(null, form({ reviewId: target!.id, selections: fullMarks, comment: "Fair." }));
    assert.ok(res.ok);
    const db = await getDb();
    const saved = db.peerReviews.find((r) => r.id === target!.id) as PeerReviewRecord;
    assert.equal(saved.status, "submitted");
    assert.equal(saved.overriddenById, teacher.id);
    assert.equal(saved.comment, "Fair.");
    assert.ok(db.auditEvents.some((e) => e.action === "peer_review.override" && e.targetId === target!.id));
    const authorId = db.assignmentSubmissions.find((s) => s.id === target!.submissionId)!.userId;
    assert.ok(db.notifications.some((n) => n.userId === authorId && n.dedupeKey === `peer-received:${target!.id}`));

    await signIn(ana.id);
    assert.equal((await submitPeerReviewAction(null, form({ reviewId: target!.id, selections: fullMarks, comment: FEEDBACK }))).ok, false, "the reviewer can no longer change it");
    const overview = await getPeerAssignmentOverview("asg_essay", { status: "overridden" });
    assert.equal(overview!.rows.length, 1);
    assert.equal(overview!.rows[0]!.overriddenBy, teacher.name);
  });

  it("reassigns an open review to a classmate who may review it", async () => {
    await mutate((db) => {
      db.assignmentSubmissions.push(makeSubmission(eli.id));
    });
    const [target] = await reviewsOf(ana.id);
    const db0 = await getDb();
    const authorId = db0.assignmentSubmissions.find((s) => s.id === target!.submissionId)!.userId;
    const other = db0.peerReviews.find((r) => r.submissionId === target!.submissionId && r.reviewerId !== ana.id)!.reviewerId;
    await signIn(teacher.id);
    assert.equal((await reassignPeerReviewAction({ reviewId: target!.id, reviewerId: authorId })).ok, false, "not to the author");
    assert.equal((await reassignPeerReviewAction({ reviewId: target!.id, reviewerId: other })).ok, false, "not to someone already reviewing it");
    assert.equal((await reassignPeerReviewAction({ reviewId: target!.id, reviewerId: teacher.id })).ok, false, "not to someone who did not submit");

    const res = await reassignPeerReviewAction({ reviewId: target!.id, reviewerId: eli.id });
    assert.ok(res.ok);
    const db = await getDb();
    assert.equal(db.peerReviews.find((r) => r.id === target!.id)!.reviewerId, eli.id);
    assert.ok(db.notifications.some((n) => n.userId === eli.id && n.link === `/peer-reviews/${target!.id}`));
    assert.deepEqual(activePeerConfig(db.assignments[0]!)!.excluded, [{ submissionId: target!.submissionId, reviewerId: ana.id }]);

    // Later allocations never put Ana back on that submission.
    await syncPeerAssignments();
    assert.ok((await reviewsOf(ana.id)).every((r) => r.submissionId !== target!.submissionId));
  });

  it("picks the classmate with the lightest load when reassigning automatically", async () => {
    await mutate((db) => {
      db.assignmentSubmissions.push(makeSubmission(eli.id));
    });
    const [target] = await reviewsOf(ana.id);
    await signIn(teacher.id);
    const res = await reassignPeerReviewAction({ reviewId: target!.id });
    assert.ok(res.ok);
    assert.equal(res.data.reviewerId, eli.id, "Eli has no reviews yet");

    await signIn(ana.id);
    const [mine] = await reviewsOf(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: mine!.id, selections: fullMarks, comment: FEEDBACK }));
    await signIn(teacher.id);
    assert.equal((await reassignPeerReviewAction({ reviewId: mine!.id })).ok, false, "submitted reviews cannot be reassigned");
  });

  it("adds an extra reviewer", async () => {
    await mutate((db) => {
      db.assignmentSubmissions.push(makeSubmission(eli.id));
    });
    await signIn(teacher.id);
    assert.equal((await addPeerReviewerAction({ submissionId: "asub_s1", reviewerId: ana.id })).ok, false, "not the author");
    const res = await addPeerReviewerAction({ submissionId: "asub_s1", reviewerId: eli.id });
    assert.ok(res.ok);
    assert.equal((await addPeerReviewerAction({ submissionId: "asub_s1", reviewerId: eli.id })).ok, false, "not twice");
    const db = await getDb();
    assert.equal(db.peerReviews.filter((r) => r.submissionId === "asub_s1").length, 3);
    assert.ok(db.notifications.some((n) => n.userId === eli.id && n.dedupeKey === `peer-assigned:${res.data.reviewId}`));
  });

  it("replaces a removed review straight away once the submission has waited long enough", async () => {
    const [target] = await reviewsOf(ana.id);
    await signIn(teacher.id);
    const res = await removePeerReviewAction(target!.id);
    assert.ok(res.ok);
    assert.equal(res.data.replaced, true, "the fixture's submissions are three days old, so a classmate may take one more");
    const db = await getDb();
    const onTarget = db.peerReviews.filter((r) => r.submissionId === target!.submissionId);
    assert.equal(onTarget.length, 2);
    assert.ok(onTarget.every((r) => r.reviewerId !== ana.id));
    const replacement = db.peerReviews.at(-1)!;
    assert.equal(replacement.status, "assigned");
    assert.ok(db.notifications.some((n) => n.userId === replacement.reviewerId && n.dedupeKey === `peer-assigned:${replacement.id}`));
  });

  it("removes a review for good and finds a replacement when a classmate is free", async () => {
    // Fresh submissions: classmates with a full load are not given extra work yet.
    await mutate((d) => {
      for (const s of d.assignmentSubmissions) s.submittedAt = new Date().toISOString();
    });
    const [target] = await reviewsOf(ana.id);
    await signIn(ana.id);
    assert.equal((await removePeerReviewAction(target!.id)).ok, false);

    await signIn(teacher.id);
    const res = await removePeerReviewAction(target!.id);
    assert.ok(res.ok);
    assert.equal(res.data.replaced, false, "everyone else already has a full load and the submission is recent");
    let db = await getDb();
    assert.equal(db.peerReviews.some((r) => r.id === target!.id), false);
    assert.deepEqual(activePeerConfig(db.assignments[0]!)!.excluded, [{ submissionId: target!.submissionId, reviewerId: ana.id }]);
    assert.ok(db.auditEvents.some((e) => e.action === "peer_review.remove"));

    await syncPeerAssignments();
    assert.equal((await reviewsOf(ana.id)).length, 1, "Ana is not given the submission again, nor a make-up review");

    // A newcomer has spare capacity and picks the orphaned slot up.
    await mutate((d) => {
      d.assignmentSubmissions.push(makeSubmission(eli.id, { submittedAt: new Date().toISOString() }));
    });
    await syncPeerAssignments();
    db = await getDb();
    assert.ok(db.peerReviews.some((r) => r.submissionId === target!.submissionId && r.reviewerId === eli.id));
    assert.equal(db.peerReviews.filter((r) => r.submissionId === target!.submissionId).length, 2);
  });

  it("keeps the exclusions when the settings are saved again", async () => {
    const [target] = await reviewsOf(ana.id);
    await signIn(teacher.id);
    await removePeerReviewAction(target!.id);
    const res = await saveAssignmentReviewSettingsAction(null, form({ assignmentId: "asg_essay", rubricId: rubric.id, peerEnabled: "on", reviewsPerSubmission: "2", dueDays: "7", anonymous: "on" }));
    assert.ok(res.ok);
    const config = activePeerConfig((await getDb()).assignments[0]!)!;
    assert.equal(config.dueDays, 7);
    assert.deepEqual(config.excluded, [{ submissionId: target!.submissionId, reviewerId: ana.id }]);
    assert.ok((await reviewsOf(ana.id)).every((r) => r.submissionId !== target!.submissionId));
  });
});

describe("reminders", () => {
  beforeEach(async () => {
    await resetDb(baseFixture());
    await syncPeerAssignments();
  });

  it("reminds each open review once before it is due and once when overdue", async () => {
    const assigned = new Date((await getDb()).peerReviews[0]!.assignedAt).getTime();
    assert.equal(await sendPeerReviewReminders(assigned + DAY), 0);
    assert.equal(await sendPeerReviewReminders(assigned + 4.5 * DAY), 8);
    assert.equal(await sendPeerReviewReminders(assigned + 4.6 * DAY), 0, "not twice");

    const [done] = await reviewsOf(ana.id);
    await signIn(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: done!.id, selections: fullMarks, comment: FEEDBACK }));
    assert.equal(await sendPeerReviewReminders(assigned + 5.5 * DAY), 7, "submitted reviews are left alone");
    assert.equal(await sendPeerReviewReminders(assigned + 8 * DAY), 0);

    const db = await getDb();
    const reminders = db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-due:") || n.dedupeKey?.startsWith("peer-overdue:"));
    assert.equal(reminders.length, 15);
    assert.ok(reminders.every((n) => n.link?.startsWith("/peer-reviews/prv_")));
    assert.ok(reminders.some((n) => n.subject.includes("overdue")));
  });

  it("lets an instructor nudge open reviewers, at most once a day", async () => {
    await signIn(ana.id);
    assert.equal((await remindPendingReviewersAction("asg_essay")).ok, false);
    await signIn(teacher.id);
    const first = await remindPendingReviewersAction("asg_essay");
    assert.ok(first.ok);
    assert.equal(first.data.reminded, 8);
    const second = await remindPendingReviewersAction("asg_essay");
    assert.ok(second.ok);
    assert.equal(second.data.reminded, 0);
    const db = await getDb();
    assert.equal(db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-nudge:")).length, 8);
    assert.ok(db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-nudge:")).every((n) => n.fromUserId === teacher.id));
  });
});

describe("reviews that count toward lesson completion", () => {
  const required = () => baseFixture({ assignments: [makeAssignment({ peer: { requiredForCompletion: true } })] });
  const lessonDone = async (userId: string) => (await getDb()).progress.some((p) => p.userId === userId && p.lessonId === lesson.id && p.status === "complete");

  it("completes the lesson when the learner's last review is in", async () => {
    await resetDb(required());
    await syncPeerAssignments();
    const mine = await reviewsOf(ana.id);
    await signIn(ana.id);
    await submitPeerReviewAction(null, form({ reviewId: mine[0]!.id, selections: fullMarks, comment: FEEDBACK }));
    assert.equal(await lessonDone(ana.id), false, "one review is still open");
    await submitPeerReviewAction(null, form({ reviewId: mine[1]!.id, selections: fullMarks, comment: FEEDBACK }));
    await settleEvents();
    assert.equal(await lessonDone(ana.id), true);
    assert.equal(await lessonDone(ben.id), false);
  });

  it("does nothing of the sort by default", async () => {
    await resetDb(baseFixture());
    await syncPeerAssignments();
    const mine = await reviewsOf(ana.id);
    await signIn(ana.id);
    for (const r of mine) await submitPeerReviewAction(null, form({ reviewId: r.id, selections: fullMarks, comment: FEEDBACK }));
    await settleEvents();
    assert.equal(await lessonDone(ana.id), false);
    assert.equal(await completeLessonsAfterPeerReview(), 0);
  });

  it("lets learners through when their open reviews are taken away or nobody else submits", async () => {
    await resetDb(required());
    await syncPeerAssignments();
    assert.equal(await completeLessonsAfterPeerReview(), 0, "everyone still owes reviews");
    await signIn(teacher.id);
    for (const r of await reviewsOf(ana.id)) assert.ok((await removePeerReviewAction(r.id)).ok);
    await settleEvents();
    assert.equal(await lessonDone(ana.id), true);
    assert.equal(await lessonDone(ben.id), false);

    // A lone submitter waits for classmates for a while, then is let through.
    await resetDb(required());
    await mutate((db) => {
      db.assignmentSubmissions = [makeSubmission(cleo.id, { submittedAt: new Date().toISOString() })];
    });
    assert.equal(await completeLessonsAfterPeerReview(), 0);
    assert.equal(await completeLessonsAfterPeerReview({ now: Date.now() + 3 * DAY }), 1);
    await settleEvents();
    assert.equal(await lessonDone(cleo.id), true);
  });

  it("releases everyone who was waiting when the option is switched off", async () => {
    await resetDb(required());
    await syncPeerAssignments();
    await signIn(teacher.id);
    const res = await saveAssignmentReviewSettingsAction(null, form({ assignmentId: "asg_essay", rubricId: rubric.id, peerEnabled: "on", reviewsPerSubmission: "2", dueDays: "5", anonymous: "on" }));
    assert.ok(res.ok);
    await settleEvents();
    for (const s of students.slice(0, 4)) assert.equal(await lessonDone(s.id), true);
    assert.equal(await lessonDone(eli.id), false, "Eli never submitted");
  });
});
