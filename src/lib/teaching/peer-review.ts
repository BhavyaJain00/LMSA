import "server-only";
import type { Assignment, AssignmentStatus, AssignmentSubmission, AssignmentType, Database, Lesson, Rubric, RubricScore, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { notify } from "@/lib/services/notifications";
import { getCompletionRequirements, setLessonStatus } from "@/lib/services/progress";
import { formatDate, pluralize, uid } from "@/lib/utils";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { lessonQuery } from "@/components/assessments/shared";
import {
  ANONYMOUS_AUTHOR_LABEL,
  ROLLING_OVERFLOW_AFTER_MS,
  activePeerConfig,
  allocationMode,
  allocationOpen,
  anonymousReviewerLabel,
  isOverdue,
  peerCompletionBlock,
  planPeerAssignments,
  reminderKey,
  reminderStage,
  reviewDueAt,
  takesPartInPeerReview,
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
 * Everything is lazy — no scheduler is required. Reviews are handed out when
 * the assignment re-renders after a submission and when the grading or peer
 * review pages render; a throttled sweep started in the background by those
 * pages covers passed deadlines, due/overdue reminders and lesson completion.
 */

const NOTIFICATION_TYPE = "assignment_graded" as const;
const SWEEP_INTERVAL_MS = 60_000;

export function asRecord(review: Database["peerReviews"][number]): PeerReviewRecord {
  return review as PeerReviewRecord;
}

/** Submissions that take part in peer review: authored by enabled, non-staff members. */
export function participatingSubmissions(db: Database, assignmentId: string): AssignmentSubmission[] {
  const users = new Map(db.users.map((u) => [u.id, u]));
  return db.assignmentSubmissions.filter((s) => {
    if (s.assignmentId !== assignmentId) return false;
    const author = users.get(s.userId);
    return !!author && takesPartInPeerReview(author);
  });
}

/**
 * Open reviews of an assignment that can no longer be written as handed out:
 * the reviewer or the author left peer review since (account disabled or
 * deleted, or given a staff role). They stop counting toward coverage and are
 * dropped by the next sync, so the submission gets a replacement reviewer.
 * Submitted reviews are kept: that feedback was given.
 */
export function staleOpenReviewIds(db: Database, assignmentId: string): Set<string> {
  const users = new Map(db.users.map((u) => [u.id, u]));
  const takesPart = (userId: string | undefined) => {
    const user = userId ? users.get(userId) : undefined;
    return !!user && takesPartInPeerReview(user);
  };
  const authorOf = new Map(db.assignmentSubmissions.filter((s) => s.assignmentId === assignmentId).map((s) => [s.id, s.userId]));
  const out = new Set<string>();
  for (const r of db.peerReviews) {
    if (r.assignmentId !== assignmentId || r.status !== "assigned") continue;
    if (!takesPart(r.reviewerId) || (authorOf.has(r.submissionId) && !takesPart(authorOf.get(r.submissionId)))) out.add(r.id);
  }
  return out;
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

/** Plan the top-up for one assignment against the current database (honouring the instructor's exclusions). */
export function planForAssignment(db: Database, assignment: Assignment, config: PeerConfig, now: number): PeerPair[] {
  const subs = participatingSubmissions(db, assignment.id);
  if (subs.length < 2) return [];
  const stale = staleOpenReviewIds(db, assignment.id);
  const existing = db.peerReviews
    .filter((r) => r.assignmentId === assignment.id && !stale.has(r.id))
    .map((r) => ({ submissionId: r.submissionId, reviewerId: r.reviewerId }));
  const deadline = allocationMode(assignment) === "deadline";
  const overflow = new Set(subs.filter((s) => deadline || now - new Date(s.submittedAt).getTime() >= ROLLING_OVERFLOW_AFTER_MS).map((s) => s.id));
  return planPeerAssignments({
    submissions: subs.map((s) => ({ id: s.id, authorId: s.userId, submittedAt: s.submittedAt })),
    existing,
    reviewsPerSubmission: config.reviewsPerSubmission,
    seed: assignment.id,
    overflow,
    exclude: config.excluded,
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
 * What a sync would change: whether orphaned reviews exist, the open reviews
 * to drop because their reviewer or author left peer review, and the new
 * reviews to hand out per assignment.
 */
function planSync(
  db: Database,
  opts: { only: Set<string> | null; force?: boolean; now: number },
): { orphans: boolean; stale: Set<string>; plans: { assignmentId: string; pairs: PeerPair[] }[] } {
  const assignmentIds = new Set(db.assignments.map((a) => a.id));
  const submissionIds = new Set(db.assignmentSubmissions.map((s) => s.id));
  const orphans = db.peerReviews.some((r) => !assignmentIds.has(r.assignmentId) || !submissionIds.has(r.submissionId));
  const stale = new Set<string>();
  const plans: { assignmentId: string; pairs: PeerPair[] }[] = [];
  for (const assignment of db.assignments) {
    if (opts.only && !opts.only.has(assignment.id)) continue;
    const config = activePeerConfig(assignment);
    if (!config) continue;
    for (const id of staleOpenReviewIds(db, assignment.id)) stale.add(id);
    if (!opts.force && !allocationOpen(assignment, opts.now)) continue;
    const pairs = planForAssignment(db, assignment, config, opts.now);
    if (pairs.length) plans.push({ assignmentId: assignment.id, pairs });
  }
  return { orphans, stale, plans };
}

/**
 * Allocate reviews for peer-reviewed assignments whose due point has passed
 * (or all of `assignmentIds` when `force`), and drop reviews whose
 * assignment or submission no longer exists. Returns the number created.
 * Cheap when there is nothing to do: the database is only written when a
 * read-only pass finds work.
 */
export async function syncPeerAssignments(opts: { assignmentIds?: string[]; force?: boolean; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const scope = { only: opts.assignmentIds ? new Set(opts.assignmentIds) : null, force: opts.force, now };
  const preview = planSync(await getDb(), scope);
  if (!preview.orphans && !preview.stale.size && !preview.plans.length) return 0;

  const nowIso = new Date(now).toISOString();
  const created = await mutate((db) => {
    // Planned again inside the write lock, so two concurrent syncs never hand out the same review twice.
    const work = planSync(db, scope);
    if (work.orphans) {
      const assignmentIds = new Set(db.assignments.map((a) => a.id));
      const submissionIds = new Set(db.assignmentSubmissions.map((s) => s.id));
      db.peerReviews = db.peerReviews.filter((r) => assignmentIds.has(r.assignmentId) && submissionIds.has(r.submissionId));
    }
    // Planned without them, so their submissions get replacement reviewers right away.
    if (work.stale.size) db.peerReviews = db.peerReviews.filter((r) => !work.stale.has(r.id));
    return work.plans.flatMap((p) => insertPairs(db, p.assignmentId, p.pairs, nowIso));
  });
  await notifyNewReviews(created);
  return created.length;
}

/** Due-soon and overdue reminders for open reviews (each sent once per review and stage). */
export async function sendPeerReviewReminders(now: number = Date.now()): Promise<number> {
  const db = await getDb();
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  const sent = new Set(db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-")).map((n) => `${n.userId}\u0000${n.dedupeKey}`));
  const stale = new Map<string, Set<string>>();
  let count = 0;
  for (const review of db.peerReviews) {
    if (review.status !== "assigned") continue;
    const assignment = assignments.get(review.assignmentId);
    const config = assignment ? activePeerConfig(assignment) : null;
    if (!assignment || !config) continue;
    // Never chase a reviewer who left peer review (the next sync drops the review).
    let dropped = stale.get(assignment.id);
    if (!dropped) stale.set(assignment.id, (dropped = staleOpenReviewIds(db, assignment.id)));
    if (dropped.has(review.id)) continue;
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

/** The lesson a learner submitted an assignment from (the one peer review may hold back), while it still embeds it. */
export function submissionLesson(db: Database, submission: Pick<AssignmentSubmission, "assignmentId" | "lessonId">): Lesson | undefined {
  if (!submission.lessonId) return undefined;
  return db.lessons.find((l) => l.id === submission.lessonId && l.blocks.some((b) => b.type === "assignment" && b.assignmentId === submission.assignmentId));
}

/**
 * Complete the lessons of learners whose peer review requirement was met
 * without them doing anything: their open reviews were removed or reassigned,
 * or no classmate turned up to be reviewed. (Submitting the last review
 * completes the lesson directly.) Only assignments that count reviews toward
 * completion are looked at, unless `released` names assignments whose
 * requirement was just switched off: everyone who was waiting there is let
 * through. Returns the number of lessons completed.
 */
export async function completeLessonsAfterPeerReview(opts: { assignmentIds?: string[]; released?: boolean; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const only = opts.assignmentIds ? new Set(opts.assignmentIds) : null;
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  let completed = 0;
  for (const assignment of db.assignments) {
    if (only && !only.has(assignment.id)) continue;
    const released = !!opts.released && !!only;
    if (!released && !activePeerConfig(assignment)?.requiredForCompletion) continue;
    for (const submission of participatingSubmissions(db, assignment.id)) {
      const lesson = submissionLesson(db, submission);
      const user = users.get(submission.userId);
      if (!lesson || !user) continue;
      if (db.progress.some((p) => p.userId === user.id && p.lessonId === lesson.id && p.status === "complete")) continue;
      if (!db.enrollments.some((e) => e.userId === user.id && e.courseId === lesson.courseId)) continue;
      const reviews = db.peerReviews.filter((r) => r.assignmentId === assignment.id && r.reviewerId === user.id);
      if (!released && peerCompletionBlock(assignment, { submittedAt: submission.submittedAt, reviews }, now)) continue;
      // Peer reviews were settled just above (with this sweep's clock and release rules).
      const requirements = await getCompletionRequirements(user, lesson, Number.MAX_SAFE_INTEGER, { now, skipPeerReview: true });
      if (!requirements.allMet) continue;
      await setLessonStatus(user, lesson, "complete");
      completed++;
    }
  }
  return completed;
}

interface SweepState {
  at: number;
  running: Promise<void> | null;
}
const sweepGlobal = globalThis as unknown as { __llPeerSweep?: SweepState };
const sweep: SweepState = (sweepGlobal.__llPeerSweep ??= { at: 0, running: null });

/**
 * Allocate due reviews, send reminders and settle lesson completion across
 * every assignment, at most once a minute per server process. Never throws.
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
      await completeLessonsAfterPeerReview({ now });
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

export interface ReceivedFeedbackRow {
  assignmentId: string;
  assignmentTitle: string;
  courseTitle: string | null;
  /** The assignment page, where the reviews can be read. */
  href: string;
  /** Classmates assigned to review the learner's submission. */
  expected: number;
  received: number;
  /** Average rubric result of the received reviews, when they were scored. */
  averagePercent: number | null;
  lastReceivedAt: string | null;
}

/** The learner's own submissions on peer-reviewed assignments and the feedback each has received so far. */
export async function listReceivedFeedback(userId: string): Promise<ReceivedFeedbackRow[]> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c.title]));
  const rows: ReceivedFeedbackRow[] = [];
  for (const submission of db.assignmentSubmissions) {
    if (submission.userId !== userId) continue;
    const assignment = db.assignments.find((a) => a.id === submission.assignmentId);
    if (!assignment || !activePeerConfig(assignment)) continue;
    const reviews = db.peerReviews.filter((r) => r.submissionId === submission.id);
    const done = reviews.filter((r) => r.status === "submitted");
    const rubric = assignment.rubricId ? db.rubrics.find((r) => r.id === assignment.rubricId) : undefined;
    const scored = done.filter((r) => r.scores?.length);
    const courseId = submission.courseId ?? assignment.courseId;
    rows.push({
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      courseTitle: courseId ? (courses.get(courseId) ?? null) : null,
      href: `/assignments/${assignment.id}${lessonQuery(submission.lessonId, submission.courseId)}`,
      expected: reviews.length,
      received: done.length,
      averagePercent: rubric && scored.length ? averageScores(rubric, scored.map((r) => r.scores)).percent : null,
      lastReceivedAt: done.map((r) => r.submittedAt ?? r.assignedAt).sort().at(-1) ?? null,
    });
  }
  return rows.sort((a, b) => (b.lastReceivedAt ?? "").localeCompare(a.lastReceivedAt ?? "") || a.assignmentTitle.localeCompare(b.assignmentTitle));
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
export type CoverageFilter = "" | "unreviewed" | "waiting" | "owing" | "done";

/** One learner's submission: the reviews it received and the reviews its author owes. */
export interface SubmissionCoverageRow {
  submissionId: string;
  author: PersonLite;
  submittedAt: string;
  grade: AssignmentStatus;
  received: { assigned: number; submitted: number };
  given: { assigned: number; submitted: number; overdue: number };
  /** Learners already reviewing this submission. */
  reviewerIds: string[];
}

export interface PeerAssignmentOverview {
  assignment: Pick<Assignment, "id" | "title" | "courseId" | "scheduleEnd">;
  courseTitle: string | null;
  config: PeerConfig;
  mode: AllocationMode;
  open: boolean;
  rubric: Rubric | null;
  rows: StaffReviewRow[];
  coverage: SubmissionCoverageRow[];
  stats: { submissions: number; assigned: number; completed: number; overdue: number; unreviewed: number };
  reviewerOptions: ReviewerOption[];
}

export async function getPeerAssignmentOverview(
  assignmentId: string,
  filter: { status?: ReviewStatusFilter; coverage?: CoverageFilter; search?: string } = {},
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
  const coverage = subs
    .map((s): SubmissionCoverageRow => {
      const received = all.filter((r) => r.submissionId === s.id);
      const given = all.filter((r) => r.reviewer.id === s.userId);
      return {
        submissionId: s.id,
        author: person(users.get(s.userId), s.userId),
        submittedAt: s.submittedAt,
        grade: s.status,
        received: { assigned: received.length, submitted: received.filter((r) => r.status === "submitted").length },
        given: { assigned: given.length, submitted: given.filter((r) => r.status === "submitted").length, overdue: given.filter((r) => r.overdue).length },
        reviewerIds: received.map((r) => r.reviewer.id),
      };
    })
    .filter((c) => {
      if (filter.coverage === "unreviewed" && c.received.assigned > 0) return false;
      if (filter.coverage === "waiting" && (c.received.assigned === 0 || c.received.submitted === c.received.assigned)) return false;
      if (filter.coverage === "owing" && c.given.submitted === c.given.assigned) return false;
      if (filter.coverage === "done" && (c.received.assigned === 0 || c.received.submitted < c.received.assigned || c.given.submitted < c.given.assigned)) return false;
      if (search && ![c.author.name, c.author.email].some((v) => v.toLowerCase().includes(search))) return false;
      return true;
    })
    .sort((a, b) => b.given.overdue - a.given.overdue || a.author.name.localeCompare(b.author.name) || a.submissionId.localeCompare(b.submissionId));
  return {
    assignment: { id: assignment.id, title: assignment.title, courseId: assignment.courseId, scheduleEnd: assignment.scheduleEnd },
    courseTitle: assignment.courseId ? (db.courses.find((c) => c.id === assignment.courseId)?.title ?? null) : null,
    config,
    mode: allocationMode(assignment),
    open: allocationOpen(assignment, now),
    rubric: assignment.rubricId ? (db.rubrics.find((r) => r.id === assignment.rubricId) ?? null) : null,
    rows,
    coverage,
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
