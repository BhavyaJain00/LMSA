import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuditEvent } from "@/lib/types";
import { auditIdList, auditTargetHref, describeAuditAction, describeAuditGroup, describeAuditTarget, auditActionGroup } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { deleteCouponAction, saveCouponAction, setCouponEnabledAction } from "@/lib/actions/coupons";
import { addBatchCourseAction, deleteBatchAction, removeBatchStudentAction, setBatchPublishedAction } from "@/lib/actions/batches";
import { createCategoryAction, deleteCategoryAction } from "@/lib/actions/categories";
import { assignBadgeAction, deleteBadgeAction } from "@/lib/actions/badges";
import { deleteQuizzesAction } from "@/lib/actions/quiz";
import { makeBatch, makeCoupon, makeCourse, makeQuiz, makeQuizSubmission, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/** Gap fill: admin-sensitive actions across the app write audit events. */

const admin = makeUser({ id: "usr_root", name: "Root Admin", roles: ["admin"] });
const student = makeUser({ id: "usr_stu", name: "Sam Student" });
const outsider = makeUser({ id: "usr_out", name: "Olive Outsider" });

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

async function events(action?: string): Promise<AuditEvent[]> {
  const db = await getDb();
  return action ? db.auditEvents.filter((e) => e.action === action) : db.auditEvents;
}

describe("audit coverage: coupons", () => {
  beforeEach(async () => {
    await resetDb({ users: [admin, outsider], coupons: [makeCoupon({ id: "cpn_spring", code: "SPRING25", redemptionCount: 3 })] });
    resetRequest();
  });

  it("records coupon deletion with the code and the actor", async () => {
    await createSession(admin.id);
    const result = await deleteCouponAction("cpn_spring");
    assert.equal(result.ok, true);
    const [event, ...rest] = await events("coupon.delete");
    assert.equal(rest.length, 0);
    assert.ok(event);
    assert.equal(event.actorId, admin.id);
    assert.equal(event.targetType, "coupon");
    assert.equal(event.targetId, "cpn_spring");
    assert.deepEqual(event.meta, { code: "SPRING25", redemptions: 3 });
    assert.equal(describeAuditAction(event.action), "Coupon deleted");
  });

  it("writes nothing when the delete is refused or the coupon is missing", async () => {
    await createSession(outsider.id);
    assert.equal((await deleteCouponAction("cpn_spring")).ok, false);
    resetRequest();
    await createSession(admin.id);
    assert.equal((await deleteCouponAction("cpn_missing")).ok, false);
    assert.equal((await events()).length, 0);
  });

  it("records create, edit and enable/disable (only real changes)", async () => {
    await createSession(admin.id);
    const created = await saveCouponAction(null, form({ code: "launch10", discountType: "percentage", value: "10", enabled: "on" }));
    assert.equal(created.ok, true);
    const id = created.ok ? created.data.id : "";
    const [create] = await events("coupon.create");
    assert.equal(create?.targetId, id);
    assert.equal(create?.meta?.code, "LAUNCH10");

    await saveCouponAction(null, form({ id, code: "LAUNCH10", discountType: "percentage", value: "15", enabled: "on" }));
    assert.equal((await events("coupon.update"))[0]?.meta?.value, 15);

    await setCouponEnabledAction(id, true); // already enabled: no event
    await setCouponEnabledAction(id, false);
    assert.equal((await events("coupon.enable")).length, 0);
    assert.equal((await events("coupon.disable")).length, 1);
  });
});

describe("audit coverage: batches", () => {
  const course = makeCourse({ id: "crs_js", title: "Modern JavaScript", published: true });

  beforeEach(async () => {
    await resetDb({
      users: [admin, student],
      courses: [course],
      batches: [makeBatch({ id: "bat_spring", slug: "spring", title: "Spring cohort", published: false, description: "Short", details: "Long", instructorIds: [admin.id] })],
      batchEnrollments: [{ id: "be_1", batchId: "bat_spring", userId: student.id, source: "Manual", confirmationEmailSent: true, enrolledAt: "2026-01-15T12:00:00.000Z" }],
    });
    resetRequest();
  });

  it("records batch deletion before redirecting", async () => {
    await createSession(admin.id);
    const target = await captureRedirect(() => deleteBatchAction("bat_spring"));
    assert.equal(target, "/admin/batches");
    const db = await getDb();
    assert.equal(db.batches.length, 0);
    const [event, ...rest] = await events("batch.delete");
    assert.equal(rest.length, 0);
    assert.ok(event);
    assert.equal(event.actorId, admin.id);
    assert.equal(event.targetType, "batch");
    assert.equal(event.targetId, "bat_spring");
    assert.equal(event.meta?.title, "Spring cohort");
    assert.equal(event.meta?.students, 1);
    // The batch page is gone, so the audit log must not link to it.
    assert.equal(auditTargetHref(event), null);
  });

  it("records publishing, members and courses", async () => {
    await createSession(admin.id);
    assert.equal((await setBatchPublishedAction("bat_spring", true)).ok, true);
    assert.equal((await setBatchPublishedAction("bat_spring", true)).ok, true); // no change: no second event
    assert.equal((await events("batch.publish")).length, 1);

    assert.equal((await addBatchCourseAction("bat_spring", course.id)).ok, true);
    const [added] = await events("batch.course_add");
    assert.equal(added?.meta?.courseId, course.id);
    assert.equal(added?.meta?.studentsEnrolled, 1);

    assert.equal((await removeBatchStudentAction("bat_spring", student.id)).ok, true);
    assert.equal((await events("batch.student_remove"))[0]?.meta?.userId, student.id);
  });
});

describe("audit coverage: categories, badges and bulk deletes", () => {
  beforeEach(async () => {
    await resetDb({
      users: [admin, student],
      badges: [{ id: "bdg_star", title: "Star", description: "Shines", imageUrl: "https://example.com/star.png", event: "course_completed", grantOnlyOnce: true, enabled: true, createdAt: "2026-01-15T12:00:00.000Z" }],
      quizzes: [makeQuiz({ id: "qz_a", title: "Quiz A" }), makeQuiz({ id: "qz_b", title: "Quiz B" })],
      quizSubmissions: [makeQuizSubmission({ quizId: "qz_a", userId: student.id })],
    });
    resetRequest();
    await createSession(admin.id);
  });

  it("records category create and delete", async () => {
    const created = await createCategoryAction(null, form({ name: "Design" }));
    assert.equal(created.ok, true);
    const id = created.ok ? created.data.id : "";
    assert.equal((await deleteCategoryAction(id)).ok, true);
    const [create] = await events("category.create");
    const [remove] = await events("category.delete");
    assert.equal(create?.meta?.slug, "design");
    assert.equal(remove?.targetId, id);
    assert.equal(remove?.meta?.unlinked, 0);
  });

  it("records badge assignment and deletion", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const assigned = await assignBadgeAction(null, form({ userId: student.id, badgeId: "bdg_star", issuedOn: today }));
    assert.equal(assigned.ok, true, assigned.ok ? "" : assigned.error);
    assert.equal((await events("badge.assign"))[0]?.meta?.userId, student.id);
    assert.equal((await deleteBadgeAction("bdg_star")).ok, true);
    const [removed] = await events("badge.delete");
    assert.equal(removed?.meta?.assignments, 1);
  });

  it("records one event per quiz in a bulk delete", async () => {
    const result = await deleteQuizzesAction(["qz_a", "qz_b", "qz_missing"]);
    assert.equal(result.ok && result.data.deleted, 2);
    const deleted = await events("quiz.delete");
    assert.deepEqual(deleted.map((e) => e.targetId).sort(), ["qz_a", "qz_b"]);
    assert.ok(deleted.every((e) => e.meta?.bulk === true));
    assert.equal(deleted.find((e) => e.targetId === "qz_a")?.meta?.submissions, 1);
  });
});

describe("audit labels for the new actions", () => {
  const actions = [
    "coupon.create", "coupon.update", "coupon.enable", "coupon.disable", "coupon.delete",
    "category.create", "category.update", "category.delete",
    "batch.create", "batch.publish", "batch.unpublish", "batch.delete", "batch.student_add", "batch.student_remove", "batch.course_add", "batch.course_remove", "batch.email_send",
    "program.create", "program.publish", "program.unpublish", "program.delete",
    "job.close", "job.reopen", "job.delete",
    "email_template.create", "email_template.update", "email_template.delete",
    "course.import", "chapter.delete", "lesson.delete",
    "quiz.delete", "quiz.submissions_delete", "question.delete",
    "assignment.delete", "assignment.submissions_delete", "exercise.delete", "exercise.submissions_delete",
    "badge.create", "badge.update", "badge.enable", "badge.disable", "badge.delete", "badge.assign", "badge.revoke",
    "enrollment.create", "enrollment.delete", "enrollment.staff",
  ];

  it("gives every action and group a dedicated label", () => {
    const humanized = (value: string) => value.replace(/[._]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    for (const action of actions) {
      assert.notEqual(describeAuditAction(action), humanized(action), `missing label for ${action}`);
      const group = auditActionGroup(action);
      assert.notEqual(describeAuditGroup(group), humanized(group), `missing group label for ${group}`);
    }
    assert.equal(describeAuditTarget("job"), "Job opening");
    assert.equal(describeAuditTarget("exercise"), "Programming exercise");
    assert.equal(describeAuditGroup("email_template"), "Email templates");
  });

  it("links targets that still exist and drops removed ones", () => {
    const ev = (action: string, targetType: string, targetId: string, meta?: AuditEvent["meta"]): AuditEvent => ({ id: "aud", action, targetType, targetId, meta, createdAt: "2026-06-01T00:00:00.000Z" });
    assert.equal(auditTargetHref(ev("batch.publish", "batch", "bat_1")), "/admin/batches/bat_1");
    assert.equal(auditTargetHref(ev("program.delete", "program", "prg_1")), null);
    assert.equal(auditTargetHref(ev("program.create", "program", "prg_1")), "/admin/programs/prg_1");
    assert.equal(auditTargetHref(ev("coupon.delete", "coupon", "cpn_1")), "/admin/settings/coupons");
    assert.equal(auditTargetHref(ev("lesson.delete", "lesson", "les_1", { courseId: "crs_1" })), "/admin/courses/crs_1?tab=outline");
    assert.equal(auditTargetHref(ev("email_template.delete", "email_template", "tpl_1", { batchId: "bat_1" })), "/admin/batches/bat_1?tab=emails");
    assert.equal(auditTargetHref(ev("quiz.delete", "quiz", "qz_1")), null);
    assert.equal(auditTargetHref(ev("enrollment.delete", "enrollment", "enr_1", { courseId: "crs_1" })), "/admin/courses/crs_1?tab=dashboard");
    assert.equal(auditTargetHref(ev("assignment.delete", "assignment", "asg_1")), null);
  });

  it("caps id lists in bulk metadata", () => {
    assert.equal(auditIdList(["a", "b"]), "a,b");
    assert.equal(auditIdList(["a", "b", "c", "d"], 2), "a,b +2 more");
    assert.equal(auditIdList([]), "");
  });
});
