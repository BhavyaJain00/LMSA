import "server-only";
import type { AssignmentSubmission, Rubric, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isModerator, isStaff } from "@/lib/auth/session";
import { rubricMaxPoints } from "./rubric-shared";

/**
 * Read models for rubrics: the admin list with filters and paging, a single
 * rubric with where it is used, and permission checks.
 */

/**
 * A submission row plus the grader's unpublished overall comments: while a
 * rubric is only partly scored, comments are kept here instead of in
 * `comments`, which the learner can read.
 */
export type SubmissionWithDraft = AssignmentSubmission & { draftComments?: string };

/** Overall comments as the grader last left them (draft first, then the published ones). */
export function graderComments(submission: AssignmentSubmission): string {
  return (submission as SubmissionWithDraft).draftComments ?? submission.comments ?? "";
}

/** Staff (creators, evaluators, moderators, admins) create rubrics and grade with them. */
export function canUseRubrics(user: Pick<User, "roles"> | null | undefined): boolean {
  return isStaff(user);
}

/** The author and moderators may edit or delete a rubric; any staff member may duplicate it. */
export function canEditRubric(user: Pick<User, "id" | "roles"> | null | undefined, rubric: Pick<Rubric, "createdById">): boolean {
  return !!user && isStaff(user) && (rubric.createdById === user.id || isModerator(user));
}

export interface RubricListRow {
  id: string;
  title: string;
  criteriaCount: number;
  maxPoints: number;
  passPercent: number;
  assignmentCount: number;
  gradedCount: number;
  authorName: string;
  mine: boolean;
  editable: boolean;
  updatedAt: string;
}

export interface RubricListFilter {
  search?: string;
  /** "used" | "unused" */
  usage?: string;
  /** Only rubrics created by the viewer. */
  mine?: boolean;
}

export async function listRubrics(viewer: User, filter: RubricListFilter = {}): Promise<RubricListRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const usage = new Map<string, number>();
  for (const a of db.assignments) if (a.rubricId) usage.set(a.rubricId, (usage.get(a.rubricId) ?? 0) + 1);
  const assignmentRubric = new Map(db.assignments.filter((a) => a.rubricId).map((a) => [a.id, a.rubricId!]));
  const graded = new Map<string, number>();
  for (const s of db.assignmentSubmissions) {
    const rubricId = assignmentRubric.get(s.assignmentId);
    if (rubricId && s.rubricScores?.length) graded.set(rubricId, (graded.get(rubricId) ?? 0) + 1);
  }
  const search = filter.search?.trim().toLowerCase();
  return db.rubrics
    .filter((r) => {
      if (search && !r.title.toLowerCase().includes(search) && !r.criteria.some((c) => c.title.toLowerCase().includes(search))) return false;
      if (filter.usage === "used" && !usage.get(r.id)) return false;
      if (filter.usage === "unused" && usage.get(r.id)) return false;
      if (filter.mine && r.createdById !== viewer.id) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((r) => ({
      id: r.id,
      title: r.title,
      criteriaCount: r.criteria.length,
      maxPoints: rubricMaxPoints(r),
      passPercent: r.passPercent,
      assignmentCount: usage.get(r.id) ?? 0,
      gradedCount: graded.get(r.id) ?? 0,
      authorName: users.get(r.createdById)?.name ?? "Deleted user",
      mine: r.createdById === viewer.id,
      editable: canEditRubric(viewer, r),
      updatedAt: r.updatedAt,
    }));
}

export async function getRubric(id: string | undefined | null): Promise<Rubric | null> {
  if (!id) return null;
  const db = await getDb();
  return db.rubrics.find((r) => r.id === id) ?? null;
}

export interface RubricUsage {
  assignments: { id: string; title: string; courseTitle: string | null; submissions: number; graded: number }[];
  gradedSubmissions: number;
  peerReviews: number;
}

/** Assignments that grade with this rubric, and how much scored work depends on it. */
export async function getRubricUsage(rubricId: string): Promise<RubricUsage> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c.title]));
  const assignments = db.assignments
    .filter((a) => a.rubricId === rubricId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((a) => {
      const subs = db.assignmentSubmissions.filter((s) => s.assignmentId === a.id);
      return {
        id: a.id,
        title: a.title,
        courseTitle: a.courseId ? (courses.get(a.courseId) ?? null) : null,
        submissions: subs.length,
        graded: subs.filter((s) => s.rubricScores?.length).length,
      };
    });
  const ids = new Set(assignments.map((a) => a.id));
  return {
    assignments,
    gradedSubmissions: assignments.reduce((n, a) => n + a.graded, 0),
    peerReviews: db.peerReviews.filter((r) => ids.has(r.assignmentId) && r.scores?.length).length,
  };
}

/** Options for the rubric picker on the assignment form. */
export async function getRubricOptions(): Promise<{ value: string; label: string }[]> {
  const db = await getDb();
  return [...db.rubrics]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((r) => ({ value: r.id, label: `${r.title} (${r.criteria.length} ${r.criteria.length === 1 ? "criterion" : "criteria"}, ${rubricMaxPoints(r)} pts)` }));
}
