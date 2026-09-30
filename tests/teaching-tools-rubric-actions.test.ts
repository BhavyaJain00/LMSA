import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, AssignmentSubmission, Rubric } from "@/lib/types";
import { deleteRubricsAction, duplicateRubricAction, gradeWithRubricAction, saveRubricAction } from "@/lib/actions/rubrics";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { getRubricOptions, getRubricUsage, graderComments, listRubrics } from "@/lib/teaching/rubrics";
import { FIXED_NOW, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/** Rubric CRUD and grading a submission with a rubric, through the server actions. */

const author = makeUser({ id: "usr_author", name: "Rita Author", roles: ["course_creator"] });
const colleague = makeUser({ id: "usr_colleague", name: "Cole Colleague", roles: ["batch_evaluator"] });
const moderator = makeUser({ id: "usr_moderator", roles: ["moderator"] });
const learner = makeUser({ id: "usr_learner", name: "Lena Learner" });

const rubric: Rubric = {
  id: "rub_lab",
  title: "Lab report",
  passPercent: 70,
  criteria: [
    { id: "crit_method", title: "Method", levels: [{ label: "Unclear", points: 0 }, { label: "Sound", points: 3 }, { label: "Rigorous", points: 5 }] },
    { id: "crit_result", title: "Results", levels: [{ label: "Missing", points: 0 }, { label: "Partial", points: 2 }, { label: "Complete", points: 5 }] },
  ],
  createdById: author.id,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};
const spare: Rubric = { ...rubric, id: "rub_spare", title: "Spare rubric", criteria: rubric.criteria.map((c) => ({ ...c, id: `${c.id}_b` })) };

const assignment: Assignment = {
  id: "asg_lab",
  title: "Lab 1",
  question: "Report your findings.",
  type: "text",
  showAnswer: false,
  gradeAssignment: true,
  enableScheduling: false,
  rubricId: rubric.id,
  authorId: author.id,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const submission: AssignmentSubmission = {
  id: "asub_lab",
  assignmentId: assignment.id,
  assignmentTitle: assignment.title,
  userId: learner.id,
  type: "text",
  answer: "We measured three samples.",
  status: "not_graded",
  submittedAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

const grid = JSON.stringify([
  { title: "Accuracy", levels: [{ label: "Low", points: 1 }, { label: "High", points: 4 }] },
  { title: "Clarity", description: "Easy to read", levels: [{ label: "Low", points: 0 }, { label: "High", points: 2 }] },
]);

const select = (method: number | null, result: number | null, comment?: string) =>
  JSON.stringify([
    ...(method === null ? [] : [{ criterionId: "crit_method", levelIndex: method, comment }]),
    ...(result === null ? [] : [{ criterionId: "crit_result", levelIndex: result }]),
  ]);

describe("rubric CRUD", () => {
  beforeEach(async () => {
    await resetDb({ users: [author, colleague, moderator, learner], rubrics: [rubric, spare], assignments: [assignment], assignmentSubmissions: [submission], settings: { email: { enabled: false } } });
  });

  it("is for staff only", async () => {
    await signIn(learner.id);
    assert.equal((await saveRubricAction(null, form({ title: "Mine", passPercent: "50", criteria: grid }))).ok, false);
    assert.equal((await duplicateRubricAction(rubric.id)).ok, false);
    assert.equal((await deleteRubricsAction([spare.id])).ok, false);
    assert.equal((await getDb()).rubrics.length, 2);
  });

  it("creates a rubric from the grid and opens it", async () => {
    await signIn(colleague.id);
    const target = await captureRedirect(() => saveRubricAction(null, form({ title: "  Quiz   essay ", passPercent: "55", criteria: grid })));
    const db = await getDb();
    const created = db.rubrics.find((r) => r.title === "Quiz essay")!;
    assert.equal(target, `/admin/rubrics/${created.id}`);
    assert.equal(created.createdById, colleague.id);
    assert.equal(created.passPercent, 55);
    assert.equal(created.criteria.length, 2);
    assert.ok(created.criteria.every((c) => /^crit_/.test(c.id)));
    assert.notEqual(created.criteria[0]!.id, created.criteria[1]!.id);
    assert.ok(db.auditEvents.some((e) => e.action === "rubric.create" && e.targetId === created.id));
  });

  it("rejects a broken grid with field errors", async () => {
    await signIn(author.id);
    const res = await saveRubricAction(null, form({ title: "", passPercent: "150", criteria: "{not json" }));
    assert.ok(!res.ok);
    assert.ok(res.fieldErrors?.title && res.fieldErrors.passPercent && res.fieldErrors.criteria);
    assert.equal((await getDb()).rubrics.length, 2);
  });

  it("lets the author or a moderator edit, keeping criterion ids so saved scores still match", async () => {
    const edited = JSON.stringify([
      { id: "crit_method", title: "Method (revised)", levels: rubric.criteria[0]!.levels },
      { title: "Discussion", levels: [{ label: "Thin", points: 1 }, { label: "Deep", points: 3 }] },
    ]);
    await signIn(colleague.id);
    const denied = await saveRubricAction(null, form({ id: rubric.id, title: "Hijacked", passPercent: "10", criteria: edited }));
    assert.equal(denied.ok, false);
    assert.equal((await getDb()).rubrics[0]!.title, "Lab report");

    await signIn(moderator.id);
    const res = await saveRubricAction(null, form({ id: rubric.id, title: "Lab report v2", passPercent: "65", criteria: edited }));
    assert.ok(res.ok);
    const saved = (await getDb()).rubrics.find((r) => r.id === rubric.id)!;
    assert.equal(saved.title, "Lab report v2");
    assert.equal(saved.passPercent, 65);
    assert.equal(saved.criteria[0]!.id, "crit_method");
    assert.match(saved.criteria[1]!.id, /^crit_/);
    assert.equal(saved.createdById, author.id, "the author does not change");
    assert.notEqual(saved.updatedAt, FIXED_NOW);
  });

  it("duplicates a rubric as the viewer's own copy with fresh criterion ids", async () => {
    await signIn(colleague.id);
    const res = await duplicateRubricAction(rubric.id);
    assert.ok(res.ok);
    const db = await getDb();
    const copy = db.rubrics.find((r) => r.id === res.data.id)!;
    assert.equal(copy.title, "Copy of Lab report");
    assert.equal(copy.createdById, colleague.id);
    assert.equal(copy.passPercent, rubric.passPercent);
    assert.deepEqual(copy.criteria.map((c) => c.levels), rubric.criteria.map((c) => c.levels));
    assert.ok(copy.criteria.every((c) => !rubric.criteria.some((o) => o.id === c.id)));
    assert.equal((await duplicateRubricAction("rub_missing")).ok, false);
  });

  it("deletes only rubrics the viewer owns that no assignment uses", async () => {
    await signIn(colleague.id);
    const foreign = await deleteRubricsAction([spare.id]);
    assert.ok(!foreign.ok);
    assert.match(foreign.error, /owned by someone else/);

    await signIn(author.id);
    const mixed = await deleteRubricsAction([rubric.id, spare.id]);
    assert.ok(mixed.ok);
    assert.equal(mixed.data.count, 1);
    assert.match(mixed.message ?? "", /still used by an assignment/);
    const db = await getDb();
    assert.deepEqual(db.rubrics.map((r) => r.id), [rubric.id]);
    assert.ok(db.auditEvents.some((e) => e.action === "rubric.delete" && e.targetId === spare.id));
    assert.equal((await deleteRubricsAction([])).ok, false);
  });

  it("lists rubrics with usage, filters and options for the picker", async () => {
    const all = await listRubrics(colleague);
    assert.equal(all.length, 2);
    const lab = all.find((r) => r.id === rubric.id)!;
    assert.equal(lab.maxPoints, 10);
    assert.equal(lab.assignmentCount, 1);
    assert.equal(lab.editable, false);
    assert.equal(lab.authorName, author.name);
    assert.deepEqual((await listRubrics(author, { usage: "unused" })).map((r) => r.id), [spare.id]);
    assert.deepEqual((await listRubrics(author, { usage: "used" })).map((r) => r.id), [rubric.id]);
    assert.equal((await listRubrics(colleague, { mine: true })).length, 0);
    assert.equal((await listRubrics(author, { search: "results" })).length, 2, "criteria are searched too");
    assert.equal((await listRubrics(author, { search: "spare" })).length, 1);
    assert.ok((await listRubrics(moderator)).every((r) => r.editable));

    const usage = await getRubricUsage(rubric.id);
    assert.deepEqual(usage.assignments, [{ id: assignment.id, title: "Lab 1", courseTitle: null, submissions: 1, graded: 0 }]);
    const options = await getRubricOptions();
    assert.deepEqual(options.map((o) => o.value), [rubric.id, spare.id]);
    assert.ok(options[0]!.label.includes("2 criteria, 10 pts"));
  });
});

describe("grading with a rubric", () => {
  beforeEach(async () => {
    await resetDb({ users: [author, colleague, moderator, learner], rubrics: [rubric], assignments: [assignment], assignmentSubmissions: [submission], settings: { email: { enabled: false } } });
  });

  const stored = async () => (await getDb()).assignmentSubmissions[0]!;
  /** Grade notifications of the learner (badges and points announce themselves separately). */
  const graded = async () => (await getDb()).notifications.filter((n) => n.userId === learner.id && n.type === "assignment_graded");

  it("is for graders only", async () => {
    await signIn(learner.id);
    const res = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 2), comments: "" }));
    assert.equal(res.ok, false);
    assert.equal((await stored()).status, "not_graded");
  });

  it("keeps a partly scored rubric as a private draft", async () => {
    await signIn(colleague.id);
    assert.equal((await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: "[]", comments: "" }))).ok, false, "nothing selected");
    const res = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(1, null, "Sample size?"), comments: "Work in progress" }));
    assert.ok(res.ok);
    assert.equal(res.data.complete, false);
    assert.equal(res.data.status, "not_graded");
    const row = await stored();
    assert.equal(row.status, "not_graded");
    assert.deepEqual(row.rubricScores, [{ criterionId: "crit_method", levelIndex: 1, points: 3, comment: "Sample size?" }]);
    assert.equal(row.comments, undefined, "draft comments stay out of the field the learner reads");
    assert.equal(graderComments(row), "Work in progress");
    assert.equal((await graded()).length, 0, "the learner hears nothing about a draft");

    // Finishing the rubric publishes the comments and drops the draft.
    const done = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(1, 2), comments: "Solid work." }));
    assert.ok(done.ok);
    const final = await stored();
    assert.equal(final.comments, "Solid work.");
    assert.equal("draftComments" in final, false);
    assert.equal(graderComments(final), "Solid work.");
  });

  it("passes at the pass mark and tells the learner", async () => {
    await signIn(colleague.id);
    // 5 + 2 = 7 of 10 at a 70 % pass mark.
    const res = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 1), comments: "Good method." }));
    await settleEvents();
    assert.ok(res.ok);
    assert.deepEqual(res.data, { status: "pass", total: 7, max: 10, percent: 70, complete: true });
    const row = await stored();
    assert.equal(row.status, "pass");
    assert.equal(row.comments, "Good method.");
    assert.equal(row.evaluatorId, colleague.id);
    assert.ok(row.gradedAt);
    assert.equal(row.rubricScores!.length, 2);
    const notes = await graded();
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.subject, /Pass/);
  });

  it("fails below the pass mark, and a regrade moves the status", async () => {
    await signIn(colleague.id);
    // 3 + 2 = 5 of 10.
    const low = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(1, 1), comments: "" }));
    assert.ok(low.ok);
    assert.equal(low.data.status, "fail");
    assert.equal((await stored()).status, "fail");

    const partial = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, null), comments: "" }));
    assert.equal(partial.ok, false, "a graded submission cannot go back to a draft");

    const high = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 2), comments: "" }));
    await settleEvents();
    assert.ok(high.ok);
    assert.equal(high.data.status, "pass");
    assert.equal((await stored()).status, "pass");
    assert.equal((await graded()).length, 2);
  });

  it("tells the learner when only the scores move", async () => {
    await signIn(colleague.id);
    await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 2), comments: "Great." }));
    const again = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 1), comments: "Great." }));
    await settleEvents();
    assert.ok(again.ok);
    assert.equal(again.data.status, "pass");
    const notes = await graded();
    assert.equal(notes.length, 2);
    assert.ok(notes.some((n) => /rubric scores/.test(n.subject) && /7 of 10/.test(n.message ?? "")));
  });

  it("shares scores as feedback on an ungraded assignment", async () => {
    await resetDb({
      users: [author, colleague, learner],
      rubrics: [rubric],
      assignments: [{ ...assignment, gradeAssignment: false }],
      assignmentSubmissions: [{ ...submission, status: "not_applicable" }],
      settings: { email: { enabled: false } },
    });
    await signIn(author.id);
    const res = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(0, 0), comments: "" }));
    assert.ok(res.ok);
    assert.equal(res.data.status, "not_applicable");
    const row = await stored();
    assert.equal(row.status, "not_applicable");
    assert.equal(row.rubricScores!.length, 2);
  });

  it("refuses when the assignment no longer has a rubric", async () => {
    await resetDb({ users: [author, learner], rubrics: [], assignments: [assignment], assignmentSubmissions: [submission], settings: { email: { enabled: false } } });
    await signIn(author.id);
    const res = await gradeWithRubricAction(null, form({ submissionId: submission.id, selections: select(2, 2), comments: "" }));
    assert.equal(res.ok, false);
    assert.equal((await stored()).rubricScores, undefined);
  });
});
