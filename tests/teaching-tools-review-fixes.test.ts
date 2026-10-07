import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, AssignmentSubmission, InstructorProfile, Organization } from "@/lib/types";
import { findLessonByNumbers, getCourseOutline } from "@/lib/data/courses";
import { getFreeResources, renderSyllabusEmail } from "@/lib/seo/lead-capture";
import { publishSweepSettled } from "@/lib/teaching/scheduling";
import { creditEarnings } from "@/lib/teaching/marketplace";
import { approveInstructorAction, rejectInstructorAction } from "@/lib/actions/marketplace";
import { saveAssignmentReviewSettingsAction } from "@/lib/actions/peer-reviews";
import { sendPeerReviewReminders, staleOpenReviewIds, syncPeerAssignments } from "@/lib/teaching/peer-review";
import { activePeerConfig, isAnonymityLocked, nextAnonymity, planPeerAssignments, type PeerConfig, type PeerPair, type PeerSubmission } from "@/lib/teaching/peer-shared";
import { createSession } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { FIXED_NOW, makeCourse, makeCourseTree, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Regression tests for the round-3 teaching-tools review findings. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

afterEach(async () => {
  await publishSweepSettled();
});

/* ------------------------------------------------------------------ */
/* Scheduled lessons: refs resolve by number, not by position          */
/* ------------------------------------------------------------------ */

describe("teaching-tools fixes: lesson refs around a scheduled lesson", () => {
  const learner = makeUser({ id: "usr_learner" });
  const instructor = makeUser({ id: "usr_teacher", roles: ["student", "course_creator"] });

  async function load(scheduled: string) {
    const tree = makeCourseTree([[{ id: "les_a", title: "A" }, { id: "les_b", title: "B" }, { id: "les_c", title: "C" }]], {
      course: { id: "crs_refs", slug: "refs", instructorIds: [instructor.id] },
    });
    await resetDb({
      users: [learner, instructor],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons.map((l) => (l.id === scheduled ? { ...l, publishAt: iso(5 * DAY) } : l)),
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
      settings: { email: { enabled: false } },
    });
    return tree.course;
  }

  it("opens the lesson after a scheduled one at its own number and hides the scheduled ref", async () => {
    const course = await load("les_b");
    const outline = await getCourseOutline(course, learner);
    assert.deepEqual(
      outline[0]!.lessons.map((l) => [l.id, l.lessonNumber]),
      [
        ["les_a", 1],
        ["les_c", 3],
      ],
    );
    assert.equal(findLessonByNumbers(outline, 1, 1)?.id, "les_a");
    assert.equal(findLessonByNumbers(outline, 1, 3)?.id, "les_c", "1-3 is C, as its link says");
    assert.equal(findLessonByNumbers(outline, 1, 2), null, "the scheduled lesson's ref resolves to nothing");
    assert.equal(findLessonByNumbers(outline, 2, 1), null);
  });

  it("does not shift the chapter when its first lesson is scheduled; staff see every lesson", async () => {
    const course = await load("les_a");
    const outline = await getCourseOutline(course, learner);
    assert.equal(findLessonByNumbers(outline, 1, 1), null);
    assert.equal(findLessonByNumbers(outline, 1, 2)?.id, "les_b");
    assert.equal(findLessonByNumbers(outline, 1, 3)?.id, "les_c");
    const staff = await getCourseOutline(course, instructor);
    assert.equal(findLessonByNumbers(staff, 1, 1)?.id, "les_a");
  });
});

/* ------------------------------------------------------------------ */
/* Scheduled lessons stay out of lead emails and /free                 */
/* ------------------------------------------------------------------ */

describe("teaching-tools fixes: scheduled lessons in lead capture", () => {
  const tree = makeCourseTree(
    [
      [
        { id: "les_w", title: "Welcome", includeInPreview: true },
        { id: "les_s", title: "Secret launch lesson", includeInPreview: true },
        { id: "les_t", title: "Third", includeInPreview: true },
      ],
    ],
    { course: { id: "crs_lead", slug: "lead", title: "Lead course" } },
  );

  beforeEach(async () => {
    await resetDb({
      users: [makeUser({ id: "usr_admin", roles: ["admin"] })],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons.map((l) => (l.id === "les_s" ? { ...l, publishAt: iso(30 * DAY) } : l)),
      settings: { email: { enabled: false } },
    });
  });

  it("leaves a scheduled preview lesson off /free and keeps the others' links", async () => {
    const resources = await getFreeResources();
    assert.deepEqual(
      resources.previews.map((p) => [p.title, p.href]),
      [
        ["Welcome", "/courses/lead/learn/1-1"],
        ["Third", "/courses/lead/learn/1-3"],
      ],
    );
  });

  it("does not list a scheduled lesson in the syllabus email", async () => {
    const email = await renderSyllabusEmail({ id: "lead_1", email: "ana@example.com", name: "Ana" }, (await getDb()).courses[0]!);
    assert.ok(!email.text.includes("Secret launch lesson") && !email.html.includes("Secret launch lesson"));
    assert.ok(email.text.includes("Welcome") && email.text.includes("Third"));
    assert.ok(email.text.includes("1.3"), "the next lesson keeps its number");
  });

  it("lists the lesson once its publish time has passed", async () => {
    await mutate((d) => {
      d.lessons.find((l) => l.id === "les_s")!.publishAt = iso(-HOUR);
    });
    const resources = await getFreeResources();
    assert.deepEqual(
      resources.previews.map((p) => p.href),
      ["/courses/lead/learn/1-1", "/courses/lead/learn/1-2", "/courses/lead/learn/1-3"],
    );
  });
});

/* ------------------------------------------------------------------ */
/* Marketplace: suspension and team seats                              */
/* ------------------------------------------------------------------ */

describe("teaching-tools fixes: marketplace", () => {
  const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
  const newbie = makeUser({ id: "usr_new", name: "Nia" });
  const veteran = makeUser({ id: "usr_vet", name: "Vic", roles: ["student", "course_creator"] });
  const buyer = makeUser({ id: "usr_buyer" });
  const courseA = makeCourse({ id: "crs_a", title: "Course A", price: 10000, paidCourse: true, instructorIds: [newbie.id] });
  const courseB = makeCourse({ id: "crs_b", title: "Course B", price: 5000, paidCourse: true, instructorIds: [veteran.id] });

  const profile = (userId: string, overrides: Partial<InstructorProfile> = {}): InstructorProfile => ({
    id: `inst_${userId}`,
    userId,
    revenueSharePercent: 50,
    status: "applied",
    payoutEmail: `${userId}@pay.test`,
    createdAt: FIXED_NOW,
    ...overrides,
  });

  const org: Organization = { id: "org_acme", name: "Acme", slug: "acme", ownerId: buyer.id, managerIds: [], seatCount: 10, courseIds: [courseA.id, courseB.id], createdAt: FIXED_NOW };

  beforeEach(async () => {
    await resetDb({
      users: [admin, newbie, veteran, buyer],
      courses: [courseA, courseB],
      instructorProfiles: [profile(newbie.id), profile(veteran.id, { status: "approved" })],
      organizations: [org],
      payments: [makePayment({ id: "pay_seats", userId: buyer.id, itemType: "seats", itemId: org.id, orgId: org.id, seats: 10, status: "paid", amount: 30000, paidAt: FIXED_NOW })],
      settings: { email: { enabled: false }, marketplace: { enabled: true } },
    });
  });

  it("takes back the course_creator role the approval granted when an instructor is suspended", async () => {
    await signIn(admin.id);
    assert.ok((await approveInstructorAction(null, form({ id: `inst_${newbie.id}`, sharePercent: "60" }))).ok);
    let db = await getDb();
    assert.ok(db.users.find((u) => u.id === newbie.id)!.roles.includes("course_creator"));
    assert.equal(db.instructorProfiles.find((p) => p.userId === newbie.id)!.roleGranted, true);

    const res = await rejectInstructorAction(null, form({ id: `inst_${newbie.id}`, reason: "Repeated policy violations in course content." }));
    assert.ok(res.ok);
    assert.match(res.message ?? "", /can no longer create courses/);
    db = await getDb();
    assert.ok(!db.users.find((u) => u.id === newbie.id)!.roles.includes("course_creator"));
    assert.equal(db.instructorProfiles.find((p) => p.userId === newbie.id)!.status, "rejected");
    assert.ok(db.auditEvents.some((e) => e.action === "user.roles" && e.targetId === newbie.id));

    // Approved again later: the role comes back.
    assert.ok((await approveInstructorAction(null, form({ id: `inst_${newbie.id}`, sharePercent: "60" }))).ok);
    assert.ok((await getDb()).users.find((u) => u.id === newbie.id)!.roles.includes("course_creator"));
  });

  it("leaves a course_creator role held before approval alone", async () => {
    await signIn(admin.id);
    const res = await rejectInstructorAction(null, form({ id: `inst_${veteran.id}`, reason: "Payout details could not be verified." }));
    assert.ok(res.ok);
    assert.match(res.message ?? "", /keep the course creator role/);
    assert.ok((await getDb()).users.find((u) => u.id === veteran.id)!.roles.includes("course_creator"));
  });

  it("credits instructors for team seats, split across the team's courses by list price", async () => {
    await mutate((d) => {
      d.instructorProfiles.find((p) => p.userId === newbie.id)!.status = "approved";
    });
    const result = await creditEarnings("pay_seats");
    assert.ok(result.credited, result.credited ? "" : result.reason);
    const rows = (await getDb()).earnings.filter((e) => e.paymentId === "pay_seats");
    const byCourse = new Map(rows.map((e) => [e.courseId, e]));
    assert.equal(byCourse.get(courseA.id)?.gross, 20000);
    assert.equal(byCourse.get(courseB.id)?.gross, 10000);
    assert.equal(byCourse.get(courseA.id)?.share, 10000);
    assert.equal(byCourse.get(courseB.id)?.instructorId, veteran.id);
    assert.equal((await creditEarnings("pay_seats")).credited, false, "idempotent");
  });

  it("finds no courses for a seats order whose team is gone", async () => {
    await mutate((d) => {
      d.organizations = [];
    });
    assert.deepEqual(await creditEarnings("pay_seats"), { credited: false, reason: "no_courses" });
  });
});

/* ------------------------------------------------------------------ */
/* Peer review: anonymity lock, rolling fairness, stale reviewers       */
/* ------------------------------------------------------------------ */

const teacher = makeUser({ id: "usr_teacher", name: "Tara Teacher", roles: ["course_creator"] });
const students = ["Ana", "Ben", "Cleo", "Dev"].map((name, i) => makeUser({ id: `usr_s${i + 1}`, name: `${name} Student` }));
const peerTree = makeCourseTree([[{ id: "les_essay", blocks: [{ id: "blk_asg", type: "assignment", assignmentId: "asg_essay" }] }]], { course: { id: "crs_writing", slug: "writing" } });

function makeAssignment(peer: Partial<PeerConfig> = {}): Assignment {
  return {
    id: "asg_essay",
    title: "Reflective essay",
    question: "Write 300 words about what you learned.",
    type: "text",
    showAnswer: false,
    gradeAssignment: true,
    courseId: peerTree.course.id,
    enableScheduling: false,
    peerReview: { enabled: true, reviewsPerSubmission: 2, dueDays: 5, anonymous: true, ...peer } as PeerConfig,
    authorId: teacher.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

function makeSubmission(userId: string): AssignmentSubmission {
  const at = new Date(Date.now() - 3 * DAY).toISOString();
  return {
    id: `asub_${userId.slice(4)}`,
    assignmentId: "asg_essay",
    assignmentTitle: "Reflective essay",
    userId,
    courseId: peerTree.course.id,
    lessonId: "les_essay",
    type: "text",
    answer: `Essay by ${userId}`,
    status: "not_graded",
    submittedAt: at,
    updatedAt: at,
  };
}

async function seedPeers(peer: Partial<PeerConfig> = {}) {
  await resetDb({
    users: [teacher, ...students],
    courses: [peerTree.course],
    chapters: peerTree.chapters,
    lessons: peerTree.lessons,
    enrollments: students.map((s) => makeEnrollment({ userId: s.id, courseId: peerTree.course.id })),
    assignments: [makeAssignment(peer)],
    assignmentSubmissions: students.map((s) => makeSubmission(s.id)),
    settings: { email: { enabled: false } },
  });
}

const settingsForm = (anonymous: boolean) =>
  form({ assignmentId: "asg_essay", rubricId: "", peerEnabled: "on", reviewsPerSubmission: "2", dueDays: "5", ...(anonymous ? { anonymous: "on" } : {}) });

describe("teaching-tools fixes: anonymity can't be switched off after reviews exist", () => {
  it("locks anonymity on only once reviews were handed out anonymously", () => {
    assert.equal(isAnonymityLocked({ anonymous: true }, 0), false);
    assert.equal(isAnonymityLocked({ anonymous: true }, 3), true);
    assert.equal(isAnonymityLocked({ anonymous: false }, 3), false);
    assert.equal(nextAnonymity({ anonymous: true }, 3, false), true);
    assert.equal(nextAnonymity({ anonymous: false }, 3, true), true, "turning it on is always allowed");
    assert.equal(nextAnonymity({ anonymous: true }, 0, false), false);
  });

  it("refuses to reveal names once reviews exist, and allows it before", async () => {
    await seedPeers();
    await signIn(teacher.id);
    const before = await saveAssignmentReviewSettingsAction(null, settingsForm(true));
    assert.ok(before.ok);
    assert.ok((await getDb()).peerReviews.length > 0, "saving handed reviews out");

    const res = await saveAssignmentReviewSettingsAction(null, settingsForm(false));
    assert.ok(!res.ok);
    assert.ok(res.fieldErrors?.anonymous);
    assert.equal(activePeerConfig((await getDb()).assignments[0]!)?.anonymous, true);
  });

  it("lets an open assignment go anonymous and stay that way", async () => {
    await seedPeers({ anonymous: false });
    await syncPeerAssignments();
    await signIn(teacher.id);
    assert.ok((await saveAssignmentReviewSettingsAction(null, settingsForm(true))).ok);
    assert.equal(activePeerConfig((await getDb()).assignments[0]!)?.anonymous, true);
    assert.ok(!(await saveAssignmentReviewSettingsAction(null, settingsForm(false))).ok);
  });

  it("can switch anonymity off while no review has been handed out", async () => {
    await resetDb({
      users: [teacher, ...students],
      courses: [peerTree.course],
      chapters: peerTree.chapters,
      lessons: peerTree.lessons,
      assignments: [makeAssignment()],
      settings: { email: { enabled: false } },
    });
    await signIn(teacher.id);
    assert.ok((await saveAssignmentReviewSettingsAction(null, settingsForm(false))).ok);
    assert.equal(activePeerConfig((await getDb()).assignments[0]!)?.anonymous, false);
  });
});

describe("teaching-tools fixes: rolling allocation stays even", () => {
  /** Learners submit one after another; reviews are handed out after each submission (no overflow yet). */
  function simulate(n: number, k: number): { received: number[]; load: number[]; pairs: PeerPair[] } {
    const subs: PeerSubmission[] = Array.from({ length: n }, (_, i) => ({
      id: `sub_${String(i + 1).padStart(2, "0")}`,
      authorId: `usr_${String(i + 1).padStart(2, "0")}`,
      submittedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const pairs: PeerPair[] = [];
    for (let i = 1; i <= n; i++) {
      pairs.push(...planPeerAssignments({ submissions: subs.slice(0, i), existing: pairs, reviewsPerSubmission: k, seed: "asg_roll" }));
      for (const s of subs.slice(0, i)) {
        assert.ok(pairs.filter((p) => p.submissionId === s.id).length <= k, `after ${i} submissions ${s.id} has at most ${k} reviewers`);
        assert.ok(pairs.filter((p) => p.reviewerId === s.authorId).length <= k);
      }
    }
    assert.ok(pairs.every((p) => subs.find((s) => s.id === p.submissionId)!.authorId !== p.reviewerId), "never self");
    return {
      received: subs.map((s) => pairs.filter((p) => p.submissionId === s.id).length),
      load: subs.map((s) => pairs.filter((p) => p.reviewerId === s.authorId).length),
      pairs,
    };
  }

  it("never gives early submissions more than k reviews (k=3, 9 learners)", () => {
    const { received, load } = simulate(9, 3);
    assert.ok(Math.max(...received) <= 3);
    assert.ok(Math.max(...load) <= 3);
    // Everyone but the last few is fully covered; the short ones are the latest submitters.
    const short = received.map((r, i) => (r < 3 ? i : -1)).filter((i) => i >= 0);
    assert.ok(short.every((i) => i >= 9 - 3), `only the last submitters wait, got ${received.join(",")}`);
  });

  it("never gives early submissions more than k reviews (k=2, 6 learners)", () => {
    const { received } = simulate(6, 2);
    assert.ok(Math.max(...received) <= 2, received.join(","));
    assert.ok(received.slice(0, 4).every((r) => r === 2), received.join(","));
  });

  it("covers the late submitters once their overflow wait is over", () => {
    const { pairs } = simulate(6, 2);
    const subs: PeerSubmission[] = Array.from({ length: 6 }, (_, i) => ({
      id: `sub_${String(i + 1).padStart(2, "0")}`,
      authorId: `usr_${String(i + 1).padStart(2, "0")}`,
      submittedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const added = planPeerAssignments({ submissions: subs, existing: pairs, reviewsPerSubmission: 2, seed: "asg_roll", overflow: new Set(subs.map((s) => s.id)) });
    const all = [...pairs, ...added];
    for (const s of subs) {
      assert.ok(all.filter((p) => p.submissionId === s.id).length >= 2, `${s.id} is reviewed`);
      assert.ok(all.filter((p) => p.reviewerId === s.authorId).length >= 2, `${s.authorId} has reviews to write`);
    }
  });
});

describe("teaching-tools fixes: open reviews of members who left peer review", () => {
  beforeEach(async () => {
    await seedPeers();
    assert.equal(await syncPeerAssignments(), 8);
  });

  it("drops a disabled reviewer's open reviews and hands the submissions to someone else", async () => {
    const [ana] = students as [(typeof students)[number]];
    await mutate((d) => {
      d.users.find((u) => u.id === ana.id)!.enabled = false;
    });
    let db = await getDb();
    const stale = staleOpenReviewIds(db, "asg_essay");
    // Ana's two reviews to write, and the two reviews of her own submission.
    assert.equal(stale.size, 4);

    // Reminders never chase her.
    await sendPeerReviewReminders(Date.now() + 5 * DAY + HOUR);
    db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === ana.id && n.dedupeKey?.startsWith("peer-overdue")).length, 0);
    assert.ok(db.notifications.some((n) => n.userId !== ana.id && n.dedupeKey?.startsWith("peer-overdue")));

    await syncPeerAssignments();
    db = await getDb();
    assert.equal(db.peerReviews.filter((r) => r.reviewerId === ana.id && r.status === "assigned").length, 0);
    const others = db.assignmentSubmissions.filter((s) => s.userId !== ana.id);
    for (const s of others) {
      const reviewers = db.peerReviews.filter((r) => r.submissionId === s.id).map((r) => r.reviewerId);
      assert.equal(reviewers.length, 2, `${s.id} still has two reviewers`);
      assert.ok(!reviewers.includes(ana.id) && !reviewers.includes(s.userId));
    }
    assert.equal(staleOpenReviewIds(db, "asg_essay").size, 0);
  });

  it("keeps reviews that were already submitted, and treats a promoted reviewer the same way", async () => {
    const [ana] = students as [(typeof students)[number]];
    await mutate((d) => {
      const first = d.peerReviews.find((r) => r.reviewerId === ana.id)!;
      first.status = "submitted";
      first.comment = "Thoughtful essay with a clear structure and an honest conclusion.";
      d.users.find((u) => u.id === ana.id)!.roles = ["student", "batch_evaluator"];
    });
    const db = await getDb();
    const stale = staleOpenReviewIds(db, "asg_essay");
    assert.ok(![...stale].some((id) => db.peerReviews.find((r) => r.id === id)?.status === "submitted"));
    await syncPeerAssignments();
    const after = await getDb();
    assert.equal(after.peerReviews.filter((r) => r.reviewerId === ana.id && r.status === "submitted").length, 1);
    assert.equal(after.peerReviews.filter((r) => r.reviewerId === ana.id && r.status === "assigned").length, 0);
  });
});
