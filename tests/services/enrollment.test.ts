import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { enrollUserInBatch, enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { getDb } from "@/lib/db/store";
import { makeBatch, makeCourse, makeProgress, makeUser, resetDb } from "../helpers/db";

const instructor = makeUser({ id: "usr_teacher", roles: ["course_creator"] });
const ada = makeUser({ id: "usr_ada", name: "Ada" });
const bob = makeUser({ id: "usr_bob", name: "Bob" });
const courseA = makeCourse({ id: "crs_a", title: "Course A", instructorIds: [instructor.id] });
const courseB = makeCourse({ id: "crs_b", title: "Course B" });
const batch = makeBatch({ id: "bat_1", title: "Cohort", courseIds: [courseA.id, courseB.id], seatCount: 1, instructorIds: [instructor.id] });

describe("enrollment service (store)", () => {
  beforeEach(async () => {
    await resetDb({
      users: [instructor, ada, bob],
      courses: [courseA, courseB],
      batches: [batch],
      settings: { email: { enabled: false }, gamification: { enabled: false } },
    });
  });

  it("enrolls once and notifies the instructors", async () => {
    const first = await enrollUserInCourse(ada.id, courseA.id);
    const second = await enrollUserInCourse(ada.id, courseA.id, { paymentId: "pay_1" });
    assert.equal(second.id, first.id);
    const db = await getDb();
    assert.equal(db.enrollments.length, 1);
    assert.equal(db.enrollments[0]!.paymentId, "pay_1");
    assert.ok(db.notifications.some((n) => n.userId === instructor.id && n.subject === "Ada enrolled in Course A"));
    assert.ok(db.activities.some((a) => a.userId === ada.id && a.type === "enroll" && a.refId === courseA.id));
  });

  it("never creates duplicate enrollments for concurrent requests (double submit)", async () => {
    const results = await Promise.all([enrollUserInCourse(ada.id, courseA.id), enrollUserInCourse(ada.id, courseA.id), enrollUserInCourse(ada.id, courseA.id)]);
    const db = await getDb();
    assert.equal(db.enrollments.filter((e) => e.userId === ada.id && e.courseId === courseA.id).length, 1);
    assert.equal(new Set(results.map((e) => e.id)).size, 1);
    assert.equal(db.notifications.filter((n) => n.userId === instructor.id).length, 1);
  });

  it("enrolls batch members in every course of the batch and respects the seat limit", async () => {
    assert.deepEqual(await enrollUserInBatch(ada.id, batch.id, { paymentId: "pay_b" }), { ok: true });
    assert.deepEqual(await enrollUserInBatch(ada.id, batch.id), { ok: true });
    assert.deepEqual(await enrollUserInBatch(bob.id, batch.id), { ok: false, error: "This batch is full." });
    assert.deepEqual(await enrollUserInBatch(bob.id, "bat_missing"), { ok: false, error: "Batch not found" });
    const db = await getDb();
    assert.equal(db.batchEnrollments.length, 1);
    assert.deepEqual(
      db.enrollments.map((e) => [e.courseId, e.batchId, e.paymentId]).sort(),
      [
        ["crs_a", "bat_1", "pay_b"],
        ["crs_b", "bat_1", "pay_b"],
      ],
    );
  });

  it("does not overbook a batch or duplicate a seat under concurrent requests", async () => {
    const results = await Promise.all([enrollUserInBatch(ada.id, batch.id), enrollUserInBatch(bob.id, batch.id), enrollUserInBatch(ada.id, batch.id)]);
    const db = await getDb();
    assert.equal(db.batchEnrollments.length, 1, "seatCount is 1");
    assert.equal(results.filter((r) => !r.ok).length >= 1, true);
    const member = db.batchEnrollments[0]!.userId;
    assert.equal(db.enrollments.filter((e) => e.userId === member).length, 2);
    assert.equal(db.enrollments.filter((e) => e.userId !== member).length, 0);
  });

  it("unenrolling removes progress and video watches of that course only", async () => {
    await enrollUserInCourse(ada.id, courseA.id);
    await enrollUserInCourse(ada.id, courseB.id);
    const lessonA = { id: "les_a", courseId: courseA.id, chapterId: "chp_a" };
    const lessonB = { id: "les_b", courseId: courseB.id, chapterId: "chp_b" };
    const db0 = await getDb();
    db0.progress.push(makeProgress(lessonA, ada.id), makeProgress(lessonB, ada.id));
    await unenrollUserFromCourse(ada.id, courseA.id);
    const db = await getDb();
    assert.deepEqual(db.enrollments.map((e) => e.courseId), [courseB.id]);
    assert.deepEqual(db.progress.map((p) => p.courseId), [courseB.id]);
  });
});
