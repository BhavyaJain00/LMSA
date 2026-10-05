import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuditEvent, JobOpening, Program } from "@/lib/types";
import { auditActionGroup, auditFacets, auditTargetHref, describeAuditAction, describeAuditGroup, filterAuditEvents, parseAuditFilter } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { createCategoryAction as createInlineCategoryAction, enrollStudentAction, removeStudentAction } from "@/lib/actions/courses";
import { addProgramCourseAction, addProgramMemberAction, deleteProgramAction, removeProgramCourseAction, removeProgramMemberAction } from "@/lib/actions/programs";
import { deleteJobAction, setJobStatusAction } from "@/lib/actions/jobs";
import { deleteEmailTemplateAction } from "@/lib/actions/email-templates";
import { deleteChapterAction } from "@/lib/actions/chapters";
import { deleteLessonAction } from "@/lib/actions/lessons";
import { deleteBatchAction } from "@/lib/actions/batches";
import { deleteCouponAction } from "@/lib/actions/coupons";
import { FIXED_NOW, makeBatch, makeCoupon, makeCourse, makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/** Gap fill: enrollment, program, job, email template and outline deletes are audited and filterable. */

const admin = makeUser({ id: "usr_root", name: "Root Admin", roles: ["admin"] });
const learner = makeUser({ id: "usr_lea", name: "Lee Learner" });
const poster = makeUser({ id: "usr_post", name: "Pat Poster" });

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

async function events(action?: string): Promise<AuditEvent[]> {
  const db = await getDb();
  return action ? db.auditEvents.filter((e) => e.action === action) : db.auditEvents;
}

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: "prg_web",
    slug: "web-path",
    title: "Web developer path",
    published: true,
    enforceCourseOrder: false,
    courseIds: [],
    createdById: admin.id,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function job(overrides: Partial<JobOpening> = {}): JobOpening {
  return {
    id: "job_dev",
    slug: "frontend-developer",
    title: "Frontend developer",
    company: "Acme",
    location: "Berlin",
    remote: false,
    type: "full_time",
    description: "Build things.",
    postedById: poster.id,
    status: "open",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe("audit coverage: staff enrollments", () => {
  const course = makeCourse({ id: "crs_ts", slug: "typescript", title: "TypeScript", published: true, instructorIds: [admin.id] });

  beforeEach(async () => {
    await resetDb({ users: [admin, learner], courses: [course] });
    resetRequest();
    await createSession(admin.id);
  });

  it("records enrolling and removing a learner", async () => {
    const enrolled = await enrollStudentAction(null, form({ courseId: course.id, userId: learner.id, memberType: "student" }));
    assert.equal(enrolled.ok, true, enrolled.ok ? "" : enrolled.error);
    const [create] = await events("enrollment.create");
    assert.ok(create);
    assert.equal(create.actorId, admin.id);
    assert.equal(create.targetType, "enrollment");
    assert.equal(create.meta?.userId, learner.id);
    assert.equal(create.meta?.courseId, course.id);
    assert.equal(create.meta?.memberType, "student");

    assert.equal((await removeStudentAction(course.id, learner.id)).ok, true);
    const [remove] = await events("enrollment.delete");
    assert.ok(remove);
    assert.equal(remove.targetId, create.targetId);
    assert.equal(remove.meta?.paid, false);
    assert.equal(describeAuditAction(remove.action), "Learner removed from a course");
  });

  it("writes nothing for a refused enrollment", async () => {
    const result = await enrollStudentAction(null, form({ courseId: course.id, userId: "usr_missing" }));
    assert.equal(result.ok, false);
    assert.equal((await events()).length, 0);
  });

  it("records categories created from the course form", async () => {
    const created = await createInlineCategoryAction("Data Science");
    assert.equal(created.ok, true);
    const [event] = await events("category.create");
    assert.equal(event?.meta?.source, "course_form");
    assert.equal(event?.meta?.slug, "data-science");
    // Re-using an existing category is not a change.
    await createInlineCategoryAction("data science");
    assert.equal((await events("category.create")).length, 1);
  });
});

describe("audit coverage: programs", () => {
  const course = makeCourse({ id: "crs_html", title: "HTML basics", published: true });

  beforeEach(async () => {
    await resetDb({
      users: [admin, learner],
      courses: [course],
      programs: [program()],
      programMembers: [],
    });
    resetRequest();
    await createSession(admin.id);
  });

  it("records course and member changes, then the deletion", async () => {
    assert.equal((await addProgramMemberAction("prg_web", learner.id)).ok, true);
    const [memberAdd] = await events("program.member_add");
    assert.equal(memberAdd?.meta?.userId, learner.id);
    assert.equal(memberAdd?.meta?.grantPaidAccess, false);

    assert.equal((await addProgramCourseAction("prg_web", course.id)).ok, true);
    const [courseAdd] = await events("program.course_add");
    assert.equal(courseAdd?.meta?.courseId, course.id);
    assert.equal(courseAdd?.meta?.enrolled, 1);

    assert.equal((await removeProgramCourseAction("prg_web", course.id)).ok, true);
    assert.equal((await events("program.course_remove"))[0]?.meta?.courseTitle, "HTML basics");

    assert.equal((await removeProgramMemberAction("prg_web", learner.id)).ok, true);
    assert.equal((await events("program.member_remove"))[0]?.meta?.userId, learner.id);

    assert.equal(await captureRedirect(() => deleteProgramAction("prg_web")), "/admin/programs");
    const [removed] = await events("program.delete");
    assert.equal(removed?.meta?.title, "Web developer path");
    assert.equal(removed ? auditTargetHref(removed) : "missing", null);
  });

  it("does not audit no-op member removals", async () => {
    assert.equal((await removeProgramMemberAction("prg_web", learner.id)).ok, false);
    assert.equal((await events()).length, 0);
  });
});

describe("audit coverage: jobs, email templates and outline deletes", () => {
  const tree = makeCourseTree([[{ id: "les_a", title: "Intro" }, { id: "les_b", title: "Setup" }]], { course: { id: "crs_go", title: "Go", instructorIds: [admin.id] } });
  const chapterId = tree.chapters[0]!.id;

  beforeEach(async () => {
    await resetDb({
      users: [admin, learner, poster],
      jobs: [job()],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
      batches: [makeBatch({ id: "bat_fall", instructorIds: [admin.id] })],
      emailTemplates: [{ id: "tpl_welcome", name: "Welcome", subject: "Hi", body: "Hello {{ student_name }}", batchId: "bat_fall", createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
    });
    resetRequest();
    await createSession(admin.id);
  });

  it("records an administrator closing and deleting someone else's job", async () => {
    assert.equal((await setJobStatusAction("job_dev", "closed")).ok, true);
    const [closed] = await events("job.close");
    assert.equal(closed?.meta?.byOwner, false);
    assert.equal((await deleteJobAction("job_dev")).ok, true);
    const [deleted] = await events("job.delete");
    assert.equal(deleted?.meta?.company, "Acme");
    assert.equal(deleted?.meta?.applications, 0);
  });

  it("records email template deletion", async () => {
    assert.equal((await deleteEmailTemplateAction("tpl_welcome")).ok, true);
    const [event] = await events("email_template.delete");
    assert.equal(event?.meta?.name, "Welcome");
    assert.equal(event?.meta?.batchId, "bat_fall");
  });

  it("records lesson and chapter deletion", async () => {
    assert.equal((await deleteLessonAction("les_a")).ok, true);
    const [lesson] = await events("lesson.delete");
    assert.equal(lesson?.targetId, "les_a");
    assert.equal(lesson?.meta?.courseId, "crs_go");
    assert.equal((await deleteChapterAction(chapterId)).ok, true);
    const [chapter] = await events("chapter.delete");
    assert.equal(chapter?.targetId, chapterId);
    assert.equal(chapter?.meta?.lessons, 1);
  });
});

describe("audit page: the new actions are filterable", () => {
  beforeEach(async () => {
    await resetDb({
      users: [admin],
      coupons: [makeCoupon({ id: "cpn_x", code: "XMAS" })],
      batches: [makeBatch({ id: "bat_x", title: "Winter cohort", instructorIds: [admin.id] })],
    });
    resetRequest();
    await createSession(admin.id);
  });

  it("finds coupon and batch deletions by action, group and target", async () => {
    assert.equal((await deleteCouponAction("cpn_x")).ok, true);
    assert.equal(await captureRedirect(() => deleteBatchAction("bat_x")), "/admin/batches");
    const all = await events();
    const actors = new Map([[admin.id, { name: admin.name, email: admin.email }]]);

    const coupons = filterAuditEvents(all, parseAuditFilter({ action: "coupon.delete" }), actors);
    assert.deepEqual(coupons.map((e) => e.targetId), ["cpn_x"]);
    const batchGroup = filterAuditEvents(all, parseAuditFilter({ action: "batch.*" }), actors);
    assert.deepEqual(batchGroup.map((e) => e.action), ["batch.delete"]);
    const byTarget = filterAuditEvents(all, parseAuditFilter({ target: "batch", q: "winter" }), actors);
    assert.equal(byTarget.length, 1);

    const facets = auditFacets(all);
    const labels = facets.groups.flatMap((g) => g.actions.map((a) => a.label));
    assert.ok(labels.includes("Coupon deleted"));
    assert.ok(labels.includes("Batch deleted"));
  });

  it("labels the program membership actions", () => {
    for (const action of ["program.member_add", "program.member_remove", "program.course_add", "program.course_remove"]) {
      const humanized = action.replace(/[._]+/g, " ").replace(/^./, (c) => c.toUpperCase());
      assert.notEqual(describeAuditAction(action), humanized, `missing label for ${action}`);
      assert.equal(describeAuditGroup(auditActionGroup(action)), "Programs");
    }
  });
});
