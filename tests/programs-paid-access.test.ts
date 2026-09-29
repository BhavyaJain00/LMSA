import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Course, Program, ProgramMember, User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { managedCourseAccess } from "@/lib/data/programs";
import { addProgramCourseAction, addProgramMemberAction, enrollInProgramAction, updateProgramAction } from "@/lib/actions/programs";
import { needsPurchaseText } from "@/components/programs/types";
import { FIXED_NOW, makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Programs and paid courses: a manager's program change (adding a member or a
 * course, lifting the course order) never enrolls members in a paid course
 * they haven't bought, unless the manager explicitly grants access without
 * payment for a course they manage.
 */

const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const owner = makeUser({ id: "usr_owner", roles: ["course_creator"] });
const payer = makeUser({ id: "usr_payer", name: "Paula Payer" });
const alex = makeUser({ id: "usr_alex", name: "Alex" });
const sam = makeUser({ id: "usr_sam", name: "Sam" });
const teacher = makeUser({ id: "usr_teacher", roles: ["course_creator"] });

const free = makeCourse({ id: "crs_free", slug: "free", title: "Free Basics" });
const paid = makeCourse({ id: "crs_paid", slug: "paid", title: "Paid Mastery", paidCourse: true, price: 4900, instructorIds: [teacher.id] });
const zeroPrice = makeCourse({ id: "crs_zero", slug: "zero", title: "Zero Priced", paidCourse: true, price: 0 });

const paidOrder = makePayment({ id: "pay_paula", userId: payer.id, itemId: paid.id, status: "paid", paidAt: FIXED_NOW });
const pendingOrder = makePayment({ id: "pay_alex_pending", userId: alex.id, itemId: paid.id, status: "pending" });

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: "prg_path",
    slug: "path",
    title: "Path",
    published: true,
    enforceCourseOrder: false,
    courseIds: [free.id, paid.id],
    createdById: admin.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function member(userId: string, programId = "prg_path"): ProgramMember {
  return { id: `pm_${userId}`, programId, userId, progress: 0, joinedAt: FIXED_NOW };
}

async function login(user: User) {
  resetRequest();
  await createSession(user.id);
}

async function enrolled(userId: string, courseId: string) {
  return (await getDb()).enrollments.find((e) => e.userId === userId && e.courseId === courseId) ?? null;
}

async function seed(extra: { programs?: Program[]; programMembers?: ProgramMember[]; courses?: Course[] } = {}) {
  await resetDb({
    users: [admin, owner, payer, alex, sam, teacher],
    courses: extra.courses ?? [free, paid, zeroPrice],
    payments: [paidOrder, pendingOrder],
    programs: extra.programs ?? [program()],
    programMembers: extra.programMembers ?? [],
  });
}

describe("managedCourseAccess", () => {
  beforeEach(() => seed());

  it("opens free courses and courses the member already paid for (linking the order)", async () => {
    const db = await getDb();
    assert.deepEqual(managedCourseAccess(db, admin, alex, free, false), { ok: true });
    assert.deepEqual(managedCourseAccess(db, admin, alex, zeroPrice, false), { ok: true });
    assert.deepEqual(managedCourseAccess(db, admin, payer, paid, false), { ok: true, paymentId: paidOrder.id });
  });

  it("requires a purchase for a paid course unless the manager grants access", async () => {
    const db = await getDb();
    // A pending order is not a purchase.
    assert.deepEqual(managedCourseAccess(db, admin, alex, paid, false), { ok: false, reason: "payment" });
    assert.deepEqual(managedCourseAccess(db, admin, alex, paid, true), { ok: true, granted: true });
    assert.deepEqual(managedCourseAccess(db, teacher, alex, paid, true), { ok: true, granted: true }, "the course's instructor may grant access");
  });

  it("never lets a manager who doesn't manage the course give it away", async () => {
    const db = await getDb();
    assert.deepEqual(managedCourseAccess(db, owner, alex, paid, true), { ok: false, reason: "payment" });
  });

  it("never charges enrolled members, moderators or the course's own staff", async () => {
    const db = await getDb();
    db.enrollments.push(makeEnrollment({ userId: sam.id, courseId: paid.id }));
    assert.deepEqual(managedCourseAccess(db, owner, sam, paid, false), { ok: true });
    assert.deepEqual(managedCourseAccess(db, owner, admin, paid, false), { ok: true });
    assert.deepEqual(managedCourseAccess(db, owner, teacher, paid, false), { ok: true });
  });
});

describe("addProgramMemberAction with paid courses", () => {
  it("enrolls a new member in free courses only and reports the purchase they need", async () => {
    await seed();
    await login(admin);
    const result = await addProgramMemberAction("prg_path", alex.id);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.ok(await enrolled(alex.id, free.id));
    assert.equal(await enrolled(alex.id, paid.id), null, "no enrollment in a paid course without a purchase");
    assert.deepEqual(result.data.needsPurchase, [{ courseId: paid.id, title: paid.title, members: 1 }]);
    assert.equal(result.data.granted, 0);
    assert.equal(result.message, "Member added to program successfully. 1 member needs to purchase Paid Mastery.");
    assert.ok((await getDb()).programMembers.some((m) => m.programId === "prg_path" && m.userId === alex.id), "the member still joins the program");
  });

  it("enrolls a member who bought the course and links the enrollment to the order", async () => {
    await seed();
    await login(admin);
    const result = await addProgramMemberAction("prg_path", payer.id);
    assert.ok(result.ok);
    assert.equal((await enrolled(payer.id, paid.id))?.paymentId, paidOrder.id);
    assert.deepEqual(result.data.needsPurchase, []);
    assert.equal(result.message, "Member added to program successfully");
  });

  it("grants access without payment only when the manager ticks the box", async () => {
    await seed();
    await login(admin);
    const result = await addProgramMemberAction("prg_path", alex.id, { grantPaidAccess: true });
    assert.ok(result.ok);
    const enrollment = await enrolled(alex.id, paid.id);
    assert.ok(enrollment, "granted enrollment");
    assert.equal(enrollment.paymentId, undefined);
    assert.equal(result.data.granted, 1);
    assert.deepEqual(result.data.needsPurchase, []);
  });

  it("ignores anything but an explicit true (tampered options)", async () => {
    await seed();
    await login(admin);
    const result = await addProgramMemberAction("prg_path", alex.id, { grantPaidAccess: "true" } as unknown as { grantPaidAccess: boolean });
    assert.ok(result.ok);
    assert.equal(await enrolled(alex.id, paid.id), null);
  });

  it("doesn't let a program owner who doesn't teach the course grant it", async () => {
    await seed({ programs: [program({ createdById: owner.id })] });
    await login(owner);
    const result = await addProgramMemberAction("prg_path", alex.id, { grantPaidAccess: true });
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(await enrolled(alex.id, paid.id), null);
    assert.match(result.message ?? "", /1 member needs to purchase Paid Mastery/);
  });

  it("with an enforced order only considers the first course", async () => {
    await seed({ programs: [program({ enforceCourseOrder: true, courseIds: [paid.id, free.id] })] });
    await login(admin);
    const result = await addProgramMemberAction("prg_path", alex.id);
    assert.ok(result.ok);
    assert.equal(await enrolled(alex.id, paid.id), null);
    assert.equal(await enrolled(alex.id, free.id), null, "later courses unlock in order");
    assert.deepEqual(result.data.needsPurchase, [{ courseId: paid.id, title: paid.title, members: 1 }]);
  });
});

describe("addProgramCourseAction with a paid course", () => {
  const withMembers = () =>
    seed({
      programs: [program({ courseIds: [free.id] })],
      programMembers: [member(payer.id), member(alex.id), member(sam.id)],
    });

  it("enrolls only the members who bought it and says how many need to purchase it", async () => {
    await withMembers();
    await login(admin);
    const result = await addProgramCourseAction("prg_path", paid.id);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal((await enrolled(payer.id, paid.id))?.paymentId, paidOrder.id);
    assert.equal(await enrolled(alex.id, paid.id), null);
    assert.equal(await enrolled(sam.id, paid.id), null);
    assert.deepEqual(result.data, { enrolled: 1, granted: 0, needsPurchase: [{ courseId: paid.id, title: paid.title, members: 2 }], waitingOnPrerequisites: 0 });
    assert.equal(result.message, "Course added to program successfully. 2 members need to purchase Paid Mastery.");
    assert.ok((await getDb()).programs[0]!.courseIds.includes(paid.id), "the course is added either way");
  });

  it("enrolls everyone when the manager grants access without payment", async () => {
    await withMembers();
    await login(admin);
    const result = await addProgramCourseAction("prg_path", paid.id, { grantPaidAccess: true });
    assert.ok(result.ok);
    for (const user of [payer, alex, sam]) assert.ok(await enrolled(user.id, paid.id), user.id);
    assert.equal((await enrolled(payer.id, paid.id))?.paymentId, paidOrder.id, "a real purchase is still linked");
    assert.equal(result.data.granted, 2);
    assert.equal(result.message, "Course added to program successfully");
  });

  it("enrolls nobody while the order is enforced (members start it from the program page)", async () => {
    await seed({ programs: [program({ enforceCourseOrder: true, courseIds: [free.id] })], programMembers: [member(payer.id), member(alex.id)] });
    await login(admin);
    const result = await addProgramCourseAction("prg_path", paid.id, { grantPaidAccess: true });
    assert.ok(result.ok);
    assert.equal(await enrolled(payer.id, paid.id), null);
    assert.equal(await enrolled(alex.id, paid.id), null);
    assert.deepEqual(result.data.needsPurchase, []);
  });

  it("keeps enrolling free courses for every member", async () => {
    await seed({ programs: [program({ courseIds: [paid.id] })], programMembers: [member(alex.id), member(sam.id)] });
    await login(admin);
    const result = await addProgramCourseAction("prg_path", free.id);
    assert.ok(result.ok);
    assert.ok(await enrolled(alex.id, free.id));
    assert.ok(await enrolled(sam.id, free.id));
    assert.equal(result.message, "Course added to program successfully");
  });
});

describe("updateProgramAction lifting the course order", () => {
  const form = (grant: boolean) => {
    const data = new FormData();
    data.set("programId", "prg_path");
    data.set("title", "Path");
    data.set("slug", "path");
    data.set("published", "on");
    if (grant) data.set("grantPaidAccess", "on");
    return data;
  };
  const enforced = () =>
    seed({
      programs: [program({ enforceCourseOrder: true, courseIds: [free.id, paid.id] })],
      programMembers: [member(payer.id), member(alex.id), member(sam.id)],
    });

  it("enrolls members in every free course and in paid courses they bought", async () => {
    await enforced();
    await login(admin);
    const result = await updateProgramAction(null, form(false));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal((await getDb()).programs[0]!.enforceCourseOrder, false);
    for (const user of [payer, alex, sam]) assert.ok(await enrolled(user.id, free.id), user.id);
    assert.ok(await enrolled(payer.id, paid.id));
    assert.equal(await enrolled(alex.id, paid.id), null);
    assert.equal(await enrolled(sam.id, paid.id), null);
    assert.deepEqual(result.data?.needsPurchase, [{ courseId: paid.id, title: paid.title, members: 2 }]);
    assert.equal(result.message, "Program updated successfully. 2 members need to purchase Paid Mastery.");
  });

  it("grants the paid courses when the form's box is ticked", async () => {
    await enforced();
    await login(admin);
    const result = await updateProgramAction(null, form(true));
    assert.ok(result.ok);
    for (const user of [payer, alex, sam]) assert.ok(await enrolled(user.id, paid.id), user.id);
    assert.equal(result.data?.granted, 2);
    assert.equal(result.message, "Program updated successfully");
  });

  it("doesn't enroll anyone when the order doesn't change", async () => {
    await seed({ programs: [program({ enforceCourseOrder: false })], programMembers: [member(alex.id)] });
    await login(admin);
    const result = await updateProgramAction(null, form(true));
    assert.ok(result.ok);
    assert.equal(result.data, undefined);
    assert.equal(await enrolled(alex.id, paid.id), null);
  });
});

describe("self-enrollment in a program", () => {
  it("still leaves paid courses behind checkout", async () => {
    await seed();
    await login(alex);
    const data = new FormData();
    data.set("programId", "prg_path");
    assert.equal(await captureRedirect(() => enrollInProgramAction(null, data)), "/programs/path");
    assert.ok(await enrolled(alex.id, free.id));
    assert.equal(await enrolled(alex.id, paid.id), null);
  });
});

describe("needsPurchaseText", () => {
  it("writes the count and the course", () => {
    assert.equal(needsPurchaseText({ title: "React", members: 1 }), "1 member needs to purchase React");
    assert.equal(needsPurchaseText({ title: "React", members: 12 }), "12 members need to purchase React");
  });
});
