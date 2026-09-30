"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, AssignmentStatus, Rubric } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notify } from "@/lib/services/notifications";
import { fd, uid } from "@/lib/utils";
import { canManageAssessments } from "@/lib/data/assessments";
import { gradeAssignmentAction } from "@/lib/actions/assignments";
import { lessonQuery } from "@/components/assessments/shared";
import { canEditRubric, canUseRubrics, type SubmissionWithDraft } from "@/lib/teaching/rubrics";
import { RUBRIC_LIMITS, cloneCriteria, formatPoints, scoreRubric, validateRubricInput, type RubricSelection } from "@/lib/teaching/rubric-shared";

const criterionId = () => uid("crit");

function parseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function revalidateRubrics(id?: string) {
  revalidatePath("/admin/rubrics");
  if (id) revalidatePath(`/admin/rubrics/${id}`);
}

/* ------------------------------------------------------------------ */
/* Create / update / duplicate / delete                                */
/* ------------------------------------------------------------------ */

/**
 * Save the grid editor. Creating redirects to the new rubric's page; an edit
 * stays on the page. Existing criterion ids are preserved so saved scores keep
 * pointing at the same rows.
 */
export async function saveRubricAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canUseRubrics(user)) return { ok: false, error: "You are not permitted to manage rubrics." };

  const id = fd(formData, "id");
  const raw = String(formData.get("criteria") ?? "");
  if (raw.length > 200_000) return { ok: false, error: "This rubric is too large." };
  const parsed = validateRubricInput({ title: formData.get("title"), passPercent: formData.get("passPercent"), criteria: parseJson(raw) }, criterionId);
  if (!parsed.ok) return parsed;

  const now = new Date().toISOString();
  if (id) {
    const db = await getDb();
    const existing = db.rubrics.find((r) => r.id === id);
    if (!existing) return { ok: false, error: "This rubric no longer exists." };
    if (!canEditRubric(user, existing)) return { ok: false, error: "Only the author or a moderator can edit this rubric. Duplicate it to make your own version." };
    await mutate((d) => {
      const row = d.rubrics.find((r) => r.id === id);
      if (!row) return;
      row.title = parsed.value.title;
      row.passPercent = parsed.value.passPercent;
      row.criteria = parsed.value.criteria;
      row.updatedAt = now;
    });
    await audit(user, "rubric.update", { type: "rubric", id }, { title: parsed.value.title, criteria: parsed.value.criteria.length });
    revalidateRubrics(id);
    return { ok: true, data: { id }, message: "Rubric saved" };
  }

  const rubric: Rubric = {
    id: uid("rub"),
    title: parsed.value.title,
    criteria: parsed.value.criteria,
    passPercent: parsed.value.passPercent,
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.rubrics.push(rubric);
  });
  await audit(user, "rubric.create", { type: "rubric", id: rubric.id }, { title: rubric.title, criteria: rubric.criteria.length });
  revalidateRubrics();
  await setFlash("Rubric created");
  redirect(`/admin/rubrics/${rubric.id}`);
}

export async function duplicateRubricAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canUseRubrics(user)) return { ok: false, error: "You are not permitted to manage rubrics." };
  const db = await getDb();
  const source = typeof id === "string" ? db.rubrics.find((r) => r.id === id) : undefined;
  if (!source) return { ok: false, error: "This rubric no longer exists." };

  const now = new Date().toISOString();
  const title = `Copy of ${source.title}`.slice(0, RUBRIC_LIMITS.titleMax);
  const copy: Rubric = {
    id: uid("rub"),
    title,
    criteria: cloneCriteria(source.criteria, criterionId),
    passPercent: source.passPercent,
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.rubrics.push(copy);
  });
  await audit(user, "rubric.duplicate", { type: "rubric", id: copy.id }, { sourceId: source.id, title });
  revalidateRubrics();
  return { ok: true, data: { id: copy.id }, message: "Rubric duplicated" };
}

/**
 * Delete rubrics the viewer may edit. Rubrics still attached to an
 * assignment are kept (detach them first) so graded work never loses the
 * criteria its scores refer to.
 */
export async function deleteRubricsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canUseRubrics(user)) return { ok: false, error: "You are not permitted to manage rubrics." };
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string"));
  if (!wanted.size) return { ok: false, error: "Select at least one rubric." };

  const result = await mutate((d) => {
    const inUse = new Set(d.assignments.map((a) => a.rubricId).filter(Boolean));
    const removed: Rubric[] = [];
    let blocked = 0;
    let forbidden = 0;
    d.rubrics = d.rubrics.filter((r) => {
      if (!wanted.has(r.id)) return true;
      if (!canEditRubric(user, r)) {
        forbidden++;
        return true;
      }
      if (inUse.has(r.id)) {
        blocked++;
        return true;
      }
      removed.push(r);
      return false;
    });
    return { removed, blocked, forbidden };
  });
  for (const r of result.removed) await audit(user, "rubric.delete", { type: "rubric", id: r.id }, { title: r.title });
  revalidateRubrics();
  for (const r of result.removed) revalidatePath(`/admin/rubrics/${r.id}`);

  const count = result.removed.length;
  const notes: string[] = [];
  if (result.blocked) notes.push(`${result.blocked} still used by an assignment`);
  if (result.forbidden) notes.push(`${result.forbidden} owned by someone else`);
  if (!count) return { ok: false, error: `Nothing was deleted: ${notes.join(", ")}.` };
  const base = count === 1 ? "Rubric deleted" : `${count} rubrics deleted`;
  return { ok: true, data: { count }, message: notes.length ? `${base} (kept ${notes.join(", ")})` : base };
}

/* ------------------------------------------------------------------ */
/* Grading with a rubric                                               */
/* ------------------------------------------------------------------ */

export interface RubricGradeResult {
  status: AssignmentStatus;
  total: number;
  max: number;
  percent: number;
  complete: boolean;
}

function parseSelections(value: string): RubricSelection[] {
  const raw = parseJson(value);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      criterionId: typeof s.criterionId === "string" ? s.criterionId : "",
      levelIndex: typeof s.levelIndex === "number" ? s.levelIndex : Number(s.levelIndex),
      comment: typeof s.comment === "string" ? s.comment : undefined,
    }))
    .filter((s) => s.criterionId && Number.isInteger(s.levelIndex));
}

/**
 * Score a submission with its assignment's rubric. A fully scored rubric
 * sets Pass/Fail from the rubric's pass mark (for graded assignments) and
 * goes through the regular grading flow, so the learner is notified and
 * badges/points follow the grade. A partly scored rubric is saved as a draft:
 * nobody is notified and the learner sees neither the scores nor the comments.
 */
export async function gradeWithRubricAction(_prev: ActionResult<RubricGradeResult> | null, formData: FormData): Promise<ActionResult<RubricGradeResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "You are not permitted to grade submissions." };

  const submissionId = fd(formData, "submissionId");
  const comments = String(formData.get("comments") ?? "").trim();
  if (comments.length > 50000) return { ok: false, error: "Comments are too long.", fieldErrors: { comments: "Comments are too long." } };

  const db = await getDb();
  const submission = db.assignmentSubmissions.find((s) => s.id === submissionId);
  if (!submission) return { ok: false, error: "This submission no longer exists." };
  const assignment = db.assignments.find((a) => a.id === submission.assignmentId);
  const rubric = assignment?.rubricId ? db.rubrics.find((r) => r.id === assignment.rubricId) : undefined;
  if (!assignment || !rubric) return { ok: false, error: "This assignment is no longer graded with a rubric. Reload the page." };

  const result = scoreRubric(rubric, parseSelections(String(formData.get("selections") ?? "")));
  if (!result.scores.length) return { ok: false, error: "Pick a level for at least one criterion.", fieldErrors: { rubric: "Pick a level for at least one criterion." } };
  const alreadyGraded = submission.status === "pass" || submission.status === "fail";
  if (!result.complete && alreadyGraded) {
    return { ok: false, error: "This submission is graded: score every criterion to update it.", fieldErrors: { rubric: "Score every criterion." } };
  }

  // Snapshot first: rows read from the store are live and change under the writes below.
  const before = { status: submission.status, comments: submission.comments ?? "" };
  const scoresChanged = JSON.stringify(submission.rubricScores ?? []) !== JSON.stringify(result.scores);
  const now = new Date().toISOString();
  await mutate((d) => {
    const row = d.assignmentSubmissions.find((s) => s.id === submissionId) as SubmissionWithDraft | undefined;
    if (!row) return;
    row.rubricScores = result.scores;
    // A draft keeps its comments away from the learner; grading publishes them through the regular flow below.
    if (result.complete || !comments) delete row.draftComments;
    else row.draftComments = comments;
    if (scoresChanged && row.userId !== user.id) row.evaluatorId = user.id;
    row.updatedAt = now;
  });

  const summary = { total: result.total, max: result.max, percent: result.percent, complete: result.complete };
  const link = `/assignments/${submission.assignmentId}${lessonQuery(submission.lessonId, submission.courseId)}`;
  revalidatePath(`/admin/assignments/submissions/${submission.id}`);
  revalidatePath(`/assignments/${submission.assignmentId}`);

  if (!result.complete) {
    revalidatePath("/admin/assignments/submissions");
    return {
      ok: true,
      data: { status: before.status, ...summary },
      message: `Draft saved (${result.scores.length} of ${rubric.criteria.length} criteria scored). Score every criterion to grade.`,
    };
  }

  const status: AssignmentStatus = assignment.gradeAssignment ? (result.passed ? "pass" : "fail") : before.status;
  const grade = new FormData();
  grade.set("submissionId", submission.id);
  grade.set("status", status);
  grade.set("comments", comments);
  const graded = await gradeAssignmentAction(null, grade);
  if (!graded.ok) return { ok: false, error: graded.error, fieldErrors: graded.fieldErrors };

  const unchanged = before.status === status && before.comments === comments;
  if (unchanged && scoresChanged) {
    // The grading flow had nothing to announce; tell the learner their scores moved.
    await notify(submission.userId, {
      type: "assignment_graded",
      subject: `Your rubric scores for ${assignment.title} were updated`,
      message: `New total: ${formatPoints(result.total)} of ${formatPoints(result.max)} points (${result.percent}%).`,
      link,
      fromUserId: user.id,
    });
  }
  return {
    ok: true,
    data: { status, ...summary },
    message: assignment.gradeAssignment
      ? `Graded ${status === "pass" ? "Pass" : "Fail"}: ${formatPoints(result.total)} / ${formatPoints(result.max)} (${result.percent}%)`
      : `Scores saved: ${formatPoints(result.total)} / ${formatPoints(result.max)}`,
  };
}
