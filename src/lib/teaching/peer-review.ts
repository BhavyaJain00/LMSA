import "server-only";
import type { Assignment, AssignmentSubmission, AssignmentType, Database, Rubric, RubricScore, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { isStaff } from "@/lib/auth/session";
import { notify } from "@/lib/services/notifications";
import { formatDate, pluralize, uid } from "@/lib/utils";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import {
  ANONYMOUS_AUTHOR_LABEL,
  ROLLING_OVERFLOW_AFTER_MS,
  activePeerConfig,
  allocationMode,
  allocationOpen,
  anonymousReviewerLabel,
  isOverdue,
  planPeerAssignments,
  reminderKey,
  reminderStage,
  reviewDueAt,
  type AllocationMode,
  type PeerConfig,
  type PeerPair,
  type PeerReviewRecord,
} from "./peer-shared";
import { averageScores, rubricMaxPoints, scorePercent, totalOfScores, type ScoreAverage } from "./rubric-shared";

/**
 * Peer review engine: hands out reviews fairly once an assignment's due
 * point is reached, reminds reviewers, and builds the read models for
 * learners (reviews to give, feedback received) and instructors (every
 * review, overrides, CSV).
 *
 * Allocation is lazy — no scheduler is required. It runs when a learner
 * completes a lesson that embeds a peer-reviewed assignment (event handler),
 * when the assignment or peer review pages render, and from a throttled
 * sweep that also sends due/overdue reminders.
 */

const NOTIFICATION_TYPE = "assignment_graded" as const;
const SWEEP_INTERVAL_MS = 60_000;

export function asRecord(review: Database["peerReviews"][number]): PeerReviewRecord {
  return review as PeerReviewRecord;
}

/** Submissions that take part in peer review: authored by enabled, non-staff members. */
function participatingSubmissions(db: Database, assignmentId: string): AssignmentSubmission[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  return db.assignmentSubmissions.filter((s) => {
    if (s.assignmentId !== assignmentId) return false;
    const author = users.get(s.userId);
    return !!author && author.enabled && !isStaff(author);
  });
}

interface CreatedReview {
  id: string;
  reviewerId: string;
  assignmentId: string;
  assignedAt: string;
}

/** Push new "assigned" rows for `pairs` (inside a `mutate`). */
function insertPairs(db: Database, assignmentId: string, pairs: PeerPair[], nowIso: string): CreatedReview[] {
  return pairs.map((pair) => {
    const review: PeerReviewRecord = {
      id: uid("prv"),
      submissionId: pair.submissionId,
      reviewerId: pair.reviewerId,
      assignmentId,
      comment: "",
      status: "assigned",
      assignedAt: nowIso,
    };
    db.peerReviews.push(review);
    return { id: review.id, reviewerId: review.reviewerId, assignmentId, assignedAt: nowIso };
  });
}

/** Plan the top-up for one assignment against the current database. */
export function planForAssignment(db: Database, assignment: Assignment, config: PeerConfig, now: number, extra: { exclude?: PeerPair[] } = {}): PeerPair[] {
  const subs = participatingSubmissions(db, assignment.id);
  if (subs.length < 2) return [];
  const existing = db.peerReviews.filter((r) => r.assignmentId === assignment.id).map((r) => ({ submissionId: r.submissionId, reviewerId: r.reviewerId }));
  const deadline = allocationMode(assignment) === "deadline";
  const overflow = new Set(subs.filter((s) => deadline || now - new Date(s.submittedAt).getTime() >= ROLLING_OVERFLOW_AFTER_MS).map((s) => s.id));
  return planPeerAssignments({
    submissions: subs.map((s) => ({ id: s.id, authorId: s.userId, submittedAt: s.submittedAt })),
    existing,
    reviewsPerSubmission: config.reviewsPerSubmission,
    seed: assignment.id,
    overflow,
    exclude: extra.exclude,
  });
}

/** Tell each reviewer about their new reviews (one notification per reviewer and assignment). */
export async function notifyNewReviews(created: CreatedReview[]): Promise<void> {
  if (!created.length) return;
  const db = await getDb();
  const groups = new Map<string, CreatedReview[]>();
  for (const c of created) {
    const key = `${c.reviewerId}\u0000${c.assignmentId}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const list of groups.values()) {
    const first = list[0]!;
    const assignment = db.assignments.find((a) => a.id === first.assignmentId);
    const config = assignment ? activePeerConfig(assignment) : null;
    if (!assignment || !config) continue;
    await notify(first.reviewerId, {
      type: NOTIFICATION_TYPE,
      subject: `You have ${pluralize(list.length, "classmate submission")} to review for ${assignment.title}`,
      message: `Share your feedback by ${formatDate(reviewDueAt(first.assignedAt, config.dueDays))}.`,
      link: list.length === 1 ? `/peer-reviews/${first.id}` : "/peer-reviews",
      dedupeKey: `peer-assigned:${first.id}`,
    });
  }
}

/**
 * Allocate reviews for peer-reviewed assignments whose due point has passed
 * (or all of `assignmentIds` when `force`), and drop reviews whose
 * assignment or submission no longer exists. Returns the number created.
 */
export async function syncPeerAssignments(opts: { assignmentIds?: string[]; force?: boolean; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const only = opts.assignmentIds ? new Set(opts.assignmentIds) : null;
  const nowIso = new Date(now).toISOString();
  const created = await mutate((db) => {
    // Orphans: the assignment or the reviewed submission was deleted.
    const assignmentIds = new Set(db.assignments.map((a) => a.id));
    const submissionIds = new Set(db.assignmentSubmissions.map((s) => s.id));
    if (db.peerReviews.some((r) => !assignmentIds.has(r.assignmentId) || !submissionIds.has(r.submissionId))) {
      db.peerReviews = db.peerReviews.filter((r) => assignmentIds.has(r.assignmentId) && submissionIds.has(r.submissionId));
    }
    const out: CreatedReview[] = [];
    for (const assignment of db.assignments) {
      if (only && !only.has(assignment.id)) continue;
      const config = activePeerConfig(assignment);
      if (!config) continue;
      if (!opts.force && !allocationOpen(assignment, now)) continue;
      const plan = planForAssignment(db, assignment, config, now);
      if (plan.length) out.push(...insertPairs(db, assignment.id, plan, nowIso));
    }
    return out;
  });
  await notifyNewReviews(created);
  return created.length;
}

/** Due-soon and overdue reminders for open reviews (each sent once per review and stage). */
export async function sendPeerReviewReminders(now: number = Date.now()): Promise<number> {
  const db = await getDb();
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  const sent = new Set(db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-")).map((n) => `${n.userId}\u0000${n.dedupeKey}`));
  let count = 0;
  for (const review of db.peerReviews) {
    if (review.status !== "assigned") continue;
    const assignment = assignments.get(review.assignmentId);
    const config = assignment ? activePeerConfig(assignment) : null;
    if (!assignment || !config) continue;
    const stage = reminderStage(review, config.dueDays, now);
    if (!stage) continue;
    const key = reminderKey(review.id, stage);
    if (sent.has(`${review.reviewerId}\u0000${key}`)) continue;
    const due = reviewDueAt(review.assignedAt, config.dueDays);
    await notify(review.reviewerId, {
      type: NOTIFICATION_TYPE,
      subject: stage === "overdue" ? `Your peer review for ${assignment.title} is overdue` : `Reminder: your peer review for ${assignment.title} is due soon`,
      message: stage === "overdue" ? "Your classmate is still waiting for your feedback. It only takes a few minutes." : `Please submit it by ${formatDate(due)}.`,
      link: `/peer-reviews/${review.id}`,
      dedupeKey: key,
    });
    count++;
  }
  return count;
}

interface SweepState {
  at: number;
  running: Promise<void> | null;
}
const sweepGlobal = globalThis as unknown as { __llPeerSweep?: SweepState };
const sweep: SweepState = (sweepGlobal.__llPeerSweep ??= { at: 0, running: null });

/**
 * Allocate due reviews and send reminders across every assignment, at most
 * once a minute per server process. Never throws.
 */
export async function runPeerReviewSweep(opts: { force?: boolean } = {}): Promise<void> {
  if (sweep.running) return sweep.running;
  const now = Date.now();
  if (!opts.force && now - sweep.at < SWEEP_INTERVAL_MS) return;
  sweep.at = now;
  sweep.running = (async () => {
    try {
      await syncPeerAssignments({ now });
      await sendPeerReviewReminders(now);
    } catch (error) {
      console.error("[peer-review] sweep failed:", error instanceof Error ? error.message : String(error));
    } finally {
      sweep.running = null;
    }
  })();
  return sweep.running;
}

/* ------------------------------------------------------------------ */
/* Learner: reviews to give                                            */
/* ------------------------------------------------------------------ */

export interface ReviewerQueueRow {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  courseTitle: string | null;
  status: "assigned" | "submitted";
  assignedAt: string;
  dueAt: string;
  submittedAt: string | null;
  overdue: boolean;
  usesRubric: boolean;
  anonymous: boolean;
}

export async function listReviewerQueue(userId: string, now: number = Date.now()): Promise<ReviewerQueueRow[]> {
  const db = await getDb();
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  const courses = new Map(db.courses.map((c) => [c.id, c.title]));
  const rows: ReviewerQueueRow[] = [];
  for (const review of db.peerReviews) {
    if (review.reviewerId !== userId) continue;
    const assignment = assignments.get(review.assignmentId);
    const config = assignment ? activePeerConfig(assignment) : null;
    if (!assignment || !config) continue;
    rows.push({
      id: review.id,
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      courseTitle: assignment.courseId ? (courses.get(assignment.courseId) ?? null) : null,
      status: review.status,
      assignedAt: review.assignedAt,
      dueAt: reviewDueAt(review.assignedAt, config.dueDays),
      submittedAt: review.submittedAt ?? null,
      overdue: isOverdue(review, config.dueDays, now),
      usesRubric: !!assignment.rubricId && db.rubrics.some((r) => r.id === assignment.rubricId),
      anonymous: config.anonymous,
    });
  }
  return rows.sort((a, b) =>
    a.status !== b.status ? (a.status === "assigned" ? -1 : 1) : a.status === "assigned" ? a.dueAt.localeCompare(b.dueAt) : (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""),
  );
}

export interface ReviewerTask {
  review: PeerReviewRecord;
  assignment: Pick<Assignment, "id" | "title" | "question">;
  config: PeerConfig;
  rubric: Rubric | null;
  submission: { type: AssignmentType; answer?: string; attachmentUrl?: string; submittedAt: string };
  authorLabel: string;
  courseTitle: string | null;
  dueAt: string;
  overdue: boolean;
  /** The reviewer can no longer change the review (graded or overridden by staff). */
  locked: boolean;
  lockReason: string | null;
}

/** A review as its reviewer sees it (null unless `userId` is the reviewer). */
export async function getReviewerTask(reviewId: string, userId: string, now: number = Date.now()): Promise<ReviewerTask | null> {
  const db = await getDb();
  const found = db.peerReviews.find((r) => r.id === reviewId && r.reviewerId === userId);
  if (!found) return null;
  const review = asRecord(found);
  const assignment = db.assignments.find((a) => a.id === review.assignmentId);
  const submission = db.assignmentSubmissions.find((s) => s.id === review.submissionId);
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!assignment || !submission || !config) return null;
  const author = db.users.find((u) => u.id === submission.userId);
  const graded = submission.status === "pass" || submission.status === "fail";
  const lockReason = review.overriddenById
    ? "An instructor has edited this review, so it can no longer be changed."
    : graded && review.status === "submitted"
      ? "The instructor has graded this submission, so your review is final."
      : null;
  return {
    review,
    assignment: { id: assignment.id, title: assignment.title, question: assignment.question },
    config,
    rubric: assignment.rubricId ? (db.rubrics.find((r) => r.id === assignment.rubricId) ?? null) : null,
    submission: { type: submission.type, answer: submission.answer, attachmentUrl: submission.attachmentUrl, submittedAt: submission.submittedAt },
    authorLabel: config.anonymous ? ANONYMOUS_AUTHOR_LABEL : (author?.name ?? "Deleted user"),
    courseTitle: assignment.courseId ? (db.courses.find((c) => c.id === assignment.courseId)?.title ?? null) : null,
    dueAt: reviewDueAt(review.assignedAt, config.dueDays),
    overdue: isOverdue(review, config.dueDays, now),
    locked: !!lockReason,
    lockReason,
  };
}

/* ------------------------------------------------------------------ */
/* Learner: feedback received                                          */
/* ------------------------------------------------------------------ */

export interface ReceivedReview {
  id: string;
  label: string;
  scores: RubricScore[];
  total: number | null;
  comment: string;
  submittedAt: string;
}

export interface PeerFeedbackSummary {
  config: PeerConfig;
  mode: AllocationMode;
  /** Reviews are handed out now (false while waiting for the deadline). */
  open: boolean;
  deadline: string | null;
  submitted: boolean;
  /** Reviews assigned on the viewer's submission (any status). */
  assignedOnMine: number;
  received: ReceivedReview[];
  average: ScoreAverage | null;
  toGive: { pending: number; done: number; nextDueAt: string | null; nextReviewId: string | null };
}

/** Order reviews of one submission stably so anonymous labels never change. */
function orderReviews<T extends { assignedAt: string; id: string }>(reviews: T[]): T[] {
  return [...reviews].sort((a, b) => a.assignedAt.localeCompare(b.assignedAt) || a.id.localeCompare(b.id));
}

export async function getPeerFeedback(userId: string, assignmentId: string, rubric: Rubric | null, now: number = Date.now()): Promise<PeerFeedbackSummary | null> {
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!assignment || !config) return null;
  const mine = db.assignmentSubmissions.find((s) => s.assignmentId === assignmentId && s.userId === userId) ?? null;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const onMine = mine ? orderReviews(db.peerReviews.filter((r) => r.submissionId === mine.id)) : [];
  const received: ReceivedReview[] = [];
  onMine.forEach((r, index) => {
    if (r.status !== "submitted") return;
    received.push({
      id: r.id,
      label: config.anonymous ? anonymousReviewerLabel(index) : (users.get(r.reviewerId)?.name ?? "Deleted user"),
      scores: r.scores ?? [],
      total: r.scores?.length ? totalOfScores(r.scores) : null,
      comment: r.comment,
      submittedAt: r.submittedAt ?? r.assignedAt,
    });
  });
  const giving = db.peerReviews.filter((r) => r.assignmentId === assignmentId && r.reviewerId === userId);
  const pending = giving
    .filter((r) => r.status === "assigned")
    .map((r) => ({ id: r.id, due: reviewDueAt(r.assignedAt, config.dueDays) }))
    .sort((a, b) => a.due.localeCompare(b.due));
  return {
    config,
    mode: allocationMode(assignment),
    open: allocationOpen(assignment, now),
    deadline: allocationMode(assignment) === "deadline" ? (assignment.scheduleEnd ?? null) : null,
    submitted: !!mine,
    assignedOnMine: onMine.length,
    received,
    average: rubric && received.some((r) => r.scores.length) ? averageScores(rubric, received.map((r) => r.scores)) : null,
    toGive: { pending: pending.length, done: giving.length - pending.length, nextDueAt: pending[0]?.due ?? null, nextReviewId: pending[0]?.id ?? null },
  };
}

/* ------------------------------------------------------------------ */
/* Staff: reviews of a submission                                      */
/* ------------------------------------------------------------------ */

export interface PersonLite {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

function person(user: User | undefined, id: string): PersonLite {
  return user ? { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl } : { id, name: "Deleted user", email: "" };
}

export interface StaffReviewRow {
  id: string;
  submissionId: string;
  author: PersonLite;
  reviewer: PersonLite;
  status: "assigned" | "submitted";
  assignedAt: string;
  dueAt: string;
  overdue: boolean;
  submittedAt: string | null;
  scores: RubricScore[];
  total: number | null;
  comment: string;
  overriddenBy: string | null;
  overriddenAt: string | null;
}

function toStaffRow(review: PeerReviewRecord, config: PeerConfig, users: Map<string, User>, authorBySubmission: Map<string, string>, now: number): StaffReviewRow {
  const authorId = authorBySubmission.get(review.submissionId) ?? "";
  return {
    id: review.id,
    submissionId: review.submissionId,
    author: person(users.get(authorId), authorId),
    reviewer: person(users.get(review.reviewerId), review.reviewerId),
    status: review.status,
    assignedAt: review.assignedAt,
    dueAt: reviewDueAt(review.assignedAt, config.dueDays),
    overdue: isOverdue(review, config.dueDays, now),
    submittedAt: review.submittedAt ?? null,
    scores: review.scores ?? [],
    total: review.scores?.length ? totalOfScores(review.scores) : null,
    comment: review.comment,
    overriddenBy: review.overriddenById ? (users.get(review.overriddenById)?.name ?? "Deleted user") : null,
    overriddenAt: review.overriddenAt ?? null,
  };
}

export interface ReviewerOption {
  value: string;
  label: string;
}

/** Everyone who may review work on this assignment (participating submitters), for reassign/add pickers. */
function reviewerOptions(db: Database, assignmentId: string): ReviewerOption[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  return participatingSubmissions(db, assignmentId)
    .map((s) => users.get(s.userId)!)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));
}

export interface SubmissionPeerPanel {
  config: PeerConfig;
  rubric: Rubric | null;
  authorId: string;
  reviews: StaffReviewRow[];
  average: ScoreAverage | null;
  reviewerOptions: ReviewerOption[];
}

export async function getSubmissionPeerPanel(submissionId: string, now: number = Date.now()): Promise<SubmissionPeerPanel | null> {
  const db = await getDb();
  const submission = db.assignmentSubmissions.find((s) => s.id === submissionId);
  const assignment = submission ? db.assignments.find((a) => a.id === submission.assignmentId) : undefined;
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!submission || !assignment || !config) return null;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const authors = new Map([[submission.id, submission.userId]]);
  const rubric = assignment.rubricId ? (db.rubrics.find((r) => r.id === assignment.rubricId) ?? null) : null;
  const reviews = orderReviews(db.peerReviews.filter((r) => r.submissionId === submission.id)).map((r) => toStaffRow(asRecord(r), config, users, authors, now));
  const scored = reviews.filter((r) => r.status === "submitted" && r.scores.length);
  return {
    config,
    rubric,
    authorId: submission.userId,
    reviews,
    average: rubric && scored.length ? averageScores(rubric, scored.map((r) => r.scores)) : null,
    reviewerOptions: reviewerOptions(db, assignment.id),
  };
}

/* ------------------------------------------------------------------ */
/* Staff: assignments with peer review                                 */
/* ------------------------------------------------------------------ */

export interface PeerAssignmentRow {
  id: string;
  title: string;
  courseTitle: string | null;
  mode: AllocationMode;
  open: boolean;
  deadline: string | null;
  reviewsPerSubmission: number;
  anonymous: boolean;
  rubricTitle: string | null;
  submissions: number;
  assigned: number;
  completed: number;
  overdue: number;
}

export async function listPeerReviewAssignments(filter: { search?: string; state?: string } = {}, now: number = Date.now()): Promise<PeerAssignmentRow[]> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c.title]));
  const rubrics = new Map(db.rubrics.map((r) => [r.id, r.title]));
  const search = filter.search?.trim().toLowerCase();
  const rows: PeerAssignmentRow[] = [];
  for (const a of db.assignments) {
    const config = activePeerConfig(a);
    if (!config) continue;
    if (search && !a.title.toLowerCase().includes(search)) continue;
    const reviews = db.peerReviews.filter((r) => r.assignmentId === a.id);
    const completed = reviews.filter((r) => r.status === "submitted").length;
    const overdue = reviews.filter((r) => isOverdue(r, config.dueDays, now)).length;
    const row: PeerAssignmentRow = {
      id: a.id,
      title: a.title,
      courseTitle: a.courseId ? (courses.get(a.courseId) ?? null) : null,
      mode: allocationMode(a),
      open: allocationOpen(a, now),
      deadline: allocationMode(a) === "deadline" ? (a.scheduleEnd ?? null) : null,
      reviewsPerSubmission: config.reviewsPerSubmission,
      anonymous: config.anonymous,
      rubricTitle: a.rubricId ? (rubrics.get(a.rubricId) ?? null) : null,
      submissions: participatingSubmissions(db, a.id).length,
      assigned: reviews.length,
      completed,
      overdue,
    };
    if (filter.state === "waiting" && row.open) continue;
    if (filter.state === "overdue" && !row.overdue) continue;
    if (filter.state === "in_progress" && (!row.open || row.assigned === 0 || row.completed === row.assigned)) continue;
    if (filter.state === "done" && (row.assigned === 0 || row.completed < row.assigned)) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => b.overdue - a.overdue || a.title.localeCompare(b.title));
}

export type ReviewStatusFilter = "" | "assigned" | "submitted" | "overdue" | "overridden";

export interface PeerAssignmentOverview {
  assignment: Pick<Assignment, "id" | "title" | "courseId" | "scheduleEnd">;
  config: PeerConfig;
  mode: AllocationMode;
  open: boolean;
  rubric: Rubric | null;
  rows: StaffReviewRow[];
  stats: { submissions: number; assigned: number; completed: number; overdue: number; unreviewed: number };
  reviewerOptions: ReviewerOption[];
}

export async function getPeerAssignmentOverview(
  assignmentId: string,
  filter: { status?: ReviewStatusFilter; search?: string } = {},
  now: number = Date.now(),
): Promise<PeerAssignmentOverview | null> {
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!assignment || !config) return null;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const subs = participatingSubmissions(db, assignment.id);
  const authors = new Map(db.assignmentSubmissions.filter((s) => s.assignmentId === assignment.id).map((s) => [s.id, s.userId]));
  const all = db.peerReviews.filter((r) => r.assignmentId === assignment.id).map((r) => toStaffRow(asRecord(r), config, users, authors, now));
  const search = filter.search?.trim().toLowerCase();
  const rows = all
    .filter((r) => {
      if (filter.status === "assigned" && r.status !== "assigned") return false;
      if (filter.status === "submitted" && r.status !== "submitted") return false;
      if (filter.status === "overdue" && !r.overdue) return false;
      if (filter.status === "overridden" && !r.overriddenBy) return false;
      if (search && ![r.author.name, r.author.email, r.reviewer.name, r.reviewer.email].some((v) => v.toLowerCase().includes(search))) return false;
      return true;
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.author.name.localeCompare(b.author.name) || a.assignedAt.localeCompare(b.assignedAt));
  const reviewed = new Set(all.map((r) => r.submissionId));
  return {
    assignment: { id: assignment.id, title: assignment.title, courseId: assignment.courseId, scheduleEnd: assignment.scheduleEnd },
    config,
    mode: allocationMode(assignment),
    open: allocationOpen(assignment, now),
    rubric: assignment.rubricId ? (db.rubrics.find((r) => r.id === assignment.rubricId) ?? null) : null,
    rows,
    stats: {
      submissions: subs.length,
      assigned: all.length,
      completed: all.filter((r) => r.status === "submitted").length,
      overdue: all.filter((r) => r.overdue).length,
      unreviewed: subs.filter((s) => !reviewed.has(s.id)).length,
    },
    reviewerOptions: reviewerOptions(db, assignment.id),
  };
}

/** Every review of an assignment as CSV (with a column per rubric criterion). */
export async function peerReviewsCsv(assignmentId: string, now: number = Date.now()): Promise<string | null> {
  const overview = await getPeerAssignmentOverview(assignmentId, {}, now);
  if (!overview) return null;
  const { rubric, rows } = overview;
  const criteria = rubric?.criteria ?? [];
  const max = rubric ? rubricMaxPoints(rubric) : 0;
  const header = [
    "Submission by",
    "Author email",
    "Reviewer",
    "Reviewer email",
    "Status",
    "Assigned",
    "Due",
    "Submitted",
    ...criteria.map((c) => c.title),
    "Total",
    "Max",
    "Percent",
    "Comment",
    "Edited by instructor",
  ];
  const lines = rows.map((r) => [
    r.author.name,
    r.author.email,
    r.reviewer.name,
    r.reviewer.email,
    r.status === "submitted" ? "Submitted" : r.overdue ? "Overdue" : "Assigned",
    r.assignedAt,
    r.dueAt,
    r.submittedAt ?? "",
    ...criteria.map((c) => {
      const s = r.scores.find((x) => x.criterionId === c.id);
      return s ? String(s.points) : "";
    }),
    r.total === null ? "" : String(r.total),
    rubric ? String(max) : "",
    r.total === null || !rubric ? "" : String(scorePercent(r.total, max)),
    r.comment,
    r.overriddenBy ?? "",
  ]);
  return toCsv([header, ...lines]);
}
