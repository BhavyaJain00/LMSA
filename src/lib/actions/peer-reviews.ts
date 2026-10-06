"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Database, PeerReview, RubricScore, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/services/notifications";
import { fd, fdBool, formatDate, toDateKey, uid } from "@/lib/utils";
import { canManageAssessments, completeLessonFromAssessment } from "@/lib/data/assessments";
import { lessonQuery } from "@/components/assessments/shared";
import { scoreRubric, type RubricSelection } from "@/lib/teaching/rubric-shared";
import {
  PEER_LIMITS,
  activePeerConfig,
  isAnonymityLocked,
  nextAnonymity,
  normalizePeerConfig,
  peerReviewRequirements,
  reviewDueAt,
  withExcludedPair,
  type PeerConfig,
  type PeerPair,
  type PeerReviewRecord,
} from "@/lib/teaching/peer-shared";
import {
  asRecord,
  completeLessonsAfterPeerReview,
  notifyNewReviews,
  participatingSubmissions,
  planForAssignment,
  submissionLesson,
  syncPeerAssignments,
} from "@/lib/teaching/peer-review";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseSelections(value: string): RubricSelection[] {
  let raw: unknown = null;
  try {
    raw = value ? JSON.parse(value) : null;
  } catch {
    raw = null;
  }
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

type ReviewContent = { ok: true; scores: RubricScore[] | undefined; comment: string } | { ok: false; error: string; fieldErrors: Record<string, string> };

/** Validate the rubric part (every criterion rated) and the written comment of a review. */
function readReviewContent(db: Database, assignmentId: string, formData: FormData, opts: { commentMin: number }): ReviewContent {
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const rubric = assignment?.rubricId ? db.rubrics.find((r) => r.id === assignment.rubricId) : undefined;
  const comment = String(formData.get("comment") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const fieldErrors: Record<string, string> = {};
  let scores: RubricScore[] | undefined;
  if (rubric) {
    const result = scoreRubric(rubric, parseSelections(String(formData.get("selections") ?? "")));
    if (!result.complete) fieldErrors.rubric = `Rate every criterion (${result.missing.length} left).`;
    scores = result.scores;
  }
  if (comment.length < opts.commentMin) {
    fieldErrors.comment = opts.commentMin > 1 ? `Write at least ${opts.commentMin} characters of feedback.` : "Write some feedback.";
  } else if (comment.length > PEER_LIMITS.commentMax) fieldErrors.comment = "Your feedback is too long.";
  const keys = Object.keys(fieldErrors);
  if (keys.length) return { ok: false, error: fieldErrors[keys[0]!]!, fieldErrors };
  return { ok: true, scores, comment };
}

function revalidatePeer(assignmentId: string, submissionId?: string, reviewId?: string) {
  revalidatePath("/peer-reviews");
  revalidatePath("/peer-reviews/manage");
  revalidatePath(`/peer-reviews/manage/${assignmentId}`);
  if (reviewId) revalidatePath(`/peer-reviews/${reviewId}`);
  if (submissionId) revalidatePath(`/admin/assignments/submissions/${submissionId}`);
  revalidatePath(`/assignments/${assignmentId}`);
}

/** Tell the author their work has new peer feedback (once per review). */
async function notifyAuthorOfFeedback(db: Database, review: PeerReview): Promise<void> {
  const submission = db.assignmentSubmissions.find((s) => s.id === review.submissionId);
  const assignment = db.assignments.find((a) => a.id === review.assignmentId);
  if (!submission || !assignment) return;
  await notify(submission.userId, {
    type: "assignment_graded",
    subject: `A classmate reviewed your work on ${assignment.title}`,
    message: "Open the assignment to read their feedback.",
    link: `/assignments/${assignment.id}${lessonQuery(submission.lessonId, submission.courseId)}`,
    dedupeKey: `peer-received:${review.id}`,
  });
}

async function requireStaff(): Promise<{ user: User } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be logged in." };
  if (!canManageAssessments(user)) return { error: "You are not permitted to manage peer reviews." };
  return { user };
}

/** Participating submitters who could review `submissionId` (not its author, not already reviewing it). */
function availableReviewers(db: Database, submissionId: string): Set<string> {
  const submission = db.assignmentSubmissions.find((s) => s.id === submissionId);
  if (!submission) return new Set();
  const busy = new Set(db.peerReviews.filter((r) => r.submissionId === submissionId).map((r) => r.reviewerId));
  return new Set(
    participatingSubmissions(db, submission.assignmentId)
      .map((s) => s.userId)
      .filter((id) => id !== submission.userId && !busy.has(id)),
  );
}

/**
 * Remember (inside a `mutate`) that an instructor took this reviewer off this
 * submission, so automatic allocation never pairs them again. Returns the
 * assignment's updated peer settings, or null when peer review is off.
 */
function excludePair(db: Database, assignmentId: string, pair: PeerPair): PeerConfig | null {
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!assignment || !config) return null;
  const next: PeerConfig = { ...config, excluded: withExcludedPair(config.excluded, pair) };
  assignment.peerReview = next;
  return next;
}

/* ------------------------------------------------------------------ */
/* Assignment settings: rubric + peer review                           */
/* ------------------------------------------------------------------ */

export interface ReviewSettingsResult {
  rubricId: string | null;
  peer: PeerConfig;
  assigned: number;
}

export async function saveAssignmentReviewSettingsAction(
  _prev: ActionResult<ReviewSettingsResult> | null,
  formData: FormData,
): Promise<ActionResult<ReviewSettingsResult>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { user } = auth;

  const assignmentId = fd(formData, "assignmentId");
  const rubricId = fd(formData, "rubricId");
  const enabled = fdBool(formData, "peerEnabled");
  const reviews = Number(fd(formData, "reviewsPerSubmission"));
  const dueDays = Number(fd(formData, "dueDays"));

  const fieldErrors: Record<string, string> = {};
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, error: "This assignment no longer exists." };
  if (rubricId && !db.rubrics.some((r) => r.id === rubricId)) fieldErrors.rubricId = "That rubric no longer exists.";
  if (enabled) {
    if (!Number.isInteger(reviews) || reviews < PEER_LIMITS.reviewsMin || reviews > PEER_LIMITS.reviewsMax) {
      fieldErrors.reviewsPerSubmission = `Choose between ${PEER_LIMITS.reviewsMin} and ${PEER_LIMITS.reviewsMax} reviews.`;
    }
    if (!Number.isInteger(dueDays) || dueDays < PEER_LIMITS.dueDaysMin || dueDays > PEER_LIMITS.dueDaysMax) {
      fieldErrors.dueDays = `Give reviewers between ${PEER_LIMITS.dueDaysMin} and ${PEER_LIMITS.dueDaysMax} days.`;
    }
  }
  const previous = normalizePeerConfig(assignment.peerReview as PeerConfig | undefined);
  const reviewCount = db.peerReviews.filter((r) => r.assignmentId === assignmentId).length;
  const requestedAnonymous = enabled ? fdBool(formData, "anonymous") : previous.anonymous;
  if (!requestedAnonymous && isAnonymityLocked(previous, reviewCount)) {
    fieldErrors.anonymous = "Reviews were already handed out anonymously, so anonymity stays on for this assignment.";
  }
  const keys = Object.keys(fieldErrors);
  if (keys.length) return { ok: false, error: fieldErrors[keys[0]!]!, fieldErrors };

  let peer = normalizePeerConfig({
    enabled,
    reviewsPerSubmission: enabled ? reviews : previous.reviewsPerSubmission,
    dueDays: enabled ? dueDays : previous.dueDays,
    anonymous: requestedAnonymous,
    requiredForCompletion: enabled ? fdBool(formData, "requiredForCompletion") : previous.requiredForCompletion,
    excluded: previous.excluded,
  });
  await mutate((d) => {
    const row = d.assignments.find((a) => a.id === assignmentId);
    if (!row) return;
    // Re-check against the stored state: reviews may have been handed out since the read above.
    const current = normalizePeerConfig(row.peerReview as PeerConfig | undefined);
    const count = d.peerReviews.filter((r) => r.assignmentId === assignmentId).length;
    peer = { ...peer, anonymous: nextAnonymity(current, count, peer.anonymous) };
    row.rubricId = rubricId || undefined;
    row.peerReview = peer;
    row.updatedAt = new Date().toISOString();
  });

  const assigned = peer.enabled ? await syncPeerAssignments({ assignmentIds: [assignmentId] }) : 0;
  // Reviews no longer count toward completion: let everyone who was waiting on them through.
  const wasRequired = previous.enabled && !!previous.requiredForCompletion;
  if (wasRequired && !(peer.enabled && peer.requiredForCompletion)) await completeLessonsAfterPeerReview({ assignmentIds: [assignmentId], released: true });
  await audit(
    user,
    "assignment.review_settings",
    { type: "assignment", id: assignmentId },
    { rubricId: rubricId || null, peerReview: peer.enabled, reviewsPerSubmission: peer.reviewsPerSubmission, anonymous: peer.anonymous },
  );
  revalidatePath(`/admin/assignments/${assignmentId}`);
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/rubrics");
  revalidatePeer(assignmentId);

  const message = assigned > 0 ? `Review settings saved. ${assigned} peer review${assigned === 1 ? "" : "s"} handed out.` : "Review settings saved";
  return { ok: true, data: { rubricId: rubricId || null, peer, assigned }, message };
}

/* ------------------------------------------------------------------ */
/* Reviewer: submit a review                                           */
/* ------------------------------------------------------------------ */

export async function submitPeerReviewAction(
  _prev: ActionResult<{ status: "submitted" }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: "submitted" }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to submit your review." };

  const reviewId = fd(formData, "reviewId");
  const db = await getDb();
  const found = db.peerReviews.find((r) => r.id === reviewId);
  if (!found || found.reviewerId !== user.id) return { ok: false, error: "This review is no longer assigned to you." };
  const review = asRecord(found);
  const assignment = db.assignments.find((a) => a.id === review.assignmentId);
  const config = assignment ? activePeerConfig(assignment) : null;
  const submission = db.assignmentSubmissions.find((s) => s.id === review.submissionId);
  if (!assignment || !config || !submission) return { ok: false, error: "Peer review has been closed for this assignment." };
  if (review.overriddenById) return { ok: false, error: "An instructor has edited this review, so it can no longer be changed." };
  if (review.status === "submitted" && (submission.status === "pass" || submission.status === "fail")) {
    return { ok: false, error: "The instructor has graded this submission, so your review is final." };
  }

  const content = readReviewContent(db, assignment.id, formData, { commentMin: PEER_LIMITS.commentMin });
  if (!content.ok) return content;

  const first = review.status !== "submitted";
  const now = new Date().toISOString();
  const saved = await mutate((d) => {
    const row = d.peerReviews.find((r) => r.id === reviewId && r.reviewerId === user.id);
    if (!row) return null;
    row.scores = content.scores;
    row.comment = content.comment;
    row.status = "submitted";
    row.submittedAt = row.submittedAt ?? now;
    return { ...row };
  });
  if (!saved) return { ok: false, error: "This review is no longer assigned to you." };

  if (first) {
    await notifyAuthorOfFeedback(db, saved);
    // Reviews that gate lesson completion: finish the lesson the reviewer submitted from once their last one is in.
    if (config.requiredForCompletion) {
      const fresh = await getDb();
      const own = fresh.assignmentSubmissions.find((s) => s.assignmentId === assignment.id && s.userId === user.id);
      const lesson = own ? submissionLesson(fresh, own) : undefined;
      if (lesson && peerReviewRequirements(fresh, user, [assignment.id], Date.now()).length === 0) await completeLessonFromAssessment(user, lesson);
    }
  }
  revalidatePeer(assignment.id, submission.id, review.id);
  return { ok: true, data: { status: "submitted" }, message: first ? "Review submitted. Thank you for your feedback!" : "Review updated" };
}

/* ------------------------------------------------------------------ */
/* Instructor: override, reassign, add, remove                         */
/* ------------------------------------------------------------------ */

/** Staff edit a review in place of the reviewer (e.g. to fix unfair scores or remove inappropriate text). */
export async function overridePeerReviewAction(
  _prev: ActionResult<{ status: "submitted" }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: "submitted" }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { user } = auth;

  const reviewId = fd(formData, "reviewId");
  const db = await getDb();
  const review = db.peerReviews.find((r) => r.id === reviewId);
  if (!review) return { ok: false, error: "This review no longer exists." };
  const content = readReviewContent(db, review.assignmentId, formData, { commentMin: 1 });
  if (!content.ok) return content;

  const first = review.status !== "submitted";
  const now = new Date().toISOString();
  const saved = await mutate((d) => {
    const row = d.peerReviews.find((r) => r.id === reviewId) as PeerReviewRecord | undefined;
    if (!row) return null;
    row.scores = content.scores;
    row.comment = content.comment;
    row.status = "submitted";
    row.submittedAt = row.submittedAt ?? now;
    row.overriddenById = user.id;
    row.overriddenAt = now;
    return { ...row };
  });
  if (!saved) return { ok: false, error: "This review no longer exists." };
  if (first) {
    await notifyAuthorOfFeedback(db, saved);
    // Written in the reviewer's place: they may have nothing left to write.
    await completeLessonsAfterPeerReview({ assignmentIds: [review.assignmentId] });
  }
  await audit(user, "peer_review.override", { type: "peer_review", id: reviewId }, { assignmentId: review.assignmentId, submissionId: review.submissionId });
  revalidatePeer(review.assignmentId, review.submissionId, reviewId);
  return { ok: true, data: { status: "submitted" }, message: "Review updated" };
}

/**
 * Give an open review to someone else: the chosen classmate, or (with an
 * empty `reviewerId`) the available classmate with the lightest load.
 */
export async function reassignPeerReviewAction(input: { reviewId: string; reviewerId?: string }): Promise<ActionResult<{ reviewerId: string }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { user } = auth;
  const reviewId = typeof input?.reviewId === "string" ? input.reviewId : "";
  const wanted = typeof input?.reviewerId === "string" ? input.reviewerId : "";

  const outcome = await mutate((d) => {
    const row = d.peerReviews.find((r) => r.id === reviewId);
    if (!row) return { ok: false, error: "This review no longer exists." } as const;
    if (row.status !== "assigned") return { ok: false, error: "Only reviews that have not been submitted can be reassigned." } as const;
    const available = availableReviewers(d, row.submissionId);
    let next = wanted;
    if (next) {
      if (!available.has(next)) return { ok: false, error: "That learner can't review this submission (it's their own, they already review it, or they haven't submitted)." } as const;
    } else {
      const load = new Map<string, number>();
      for (const r of d.peerReviews) if (r.assignmentId === row.assignmentId) load.set(r.reviewerId, (load.get(r.reviewerId) ?? 0) + 1);
      next = [...available].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0] ?? "";
      if (!next) return { ok: false, error: "No other classmate is available to review this submission." } as const;
    }
    const previous = row.reviewerId;
    row.reviewerId = next;
    row.assignedAt = new Date().toISOString();
    excludePair(d, row.assignmentId, { submissionId: row.submissionId, reviewerId: previous });
    return { ok: true, review: { ...row }, previous } as const;
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await notifyNewReviews([{ id: outcome.review.id, reviewerId: outcome.review.reviewerId, assignmentId: outcome.review.assignmentId, assignedAt: outcome.review.assignedAt }]);
  await audit(user, "peer_review.reassign", { type: "peer_review", id: reviewId }, { from: outcome.previous, to: outcome.review.reviewerId });
  // The previous reviewer may have nothing left to write.
  await completeLessonsAfterPeerReview({ assignmentIds: [outcome.review.assignmentId] });
  revalidatePeer(outcome.review.assignmentId, outcome.review.submissionId, reviewId);
  const db = await getDb();
  const name = db.users.find((u) => u.id === outcome.review.reviewerId)?.name ?? "another learner";
  return { ok: true, data: { reviewerId: outcome.review.reviewerId }, message: `Review reassigned to ${name}` };
}

/** Add one more reviewer to a submission. */
export async function addPeerReviewerAction(input: { submissionId: string; reviewerId: string }): Promise<ActionResult<{ reviewId: string }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { user } = auth;
  const submissionId = typeof input?.submissionId === "string" ? input.submissionId : "";
  const reviewerId = typeof input?.reviewerId === "string" ? input.reviewerId : "";

  const outcome = await mutate((d) => {
    const submission = d.assignmentSubmissions.find((s) => s.id === submissionId);
    if (!submission) return { ok: false, error: "This submission no longer exists." } as const;
    const assignment = d.assignments.find((a) => a.id === submission.assignmentId);
    if (!assignment || !activePeerConfig(assignment)) return { ok: false, error: "Peer review is off for this assignment." } as const;
    if (!availableReviewers(d, submissionId).has(reviewerId)) {
      return { ok: false, error: "That learner can't review this submission (it's their own, they already review it, or they haven't submitted)." } as const;
    }
    const review: PeerReview = {
      id: uid("prv"),
      submissionId,
      reviewerId,
      assignmentId: assignment.id,
      comment: "",
      status: "assigned",
      assignedAt: new Date().toISOString(),
    };
    d.peerReviews.push(review);
    return { ok: true, review } as const;
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const { review } = outcome;
  await notifyNewReviews([{ id: review.id, reviewerId: review.reviewerId, assignmentId: review.assignmentId, assignedAt: review.assignedAt }]);
  await audit(user, "peer_review.add", { type: "peer_review", id: review.id }, { submissionId, reviewerId });
  revalidatePeer(review.assignmentId, submissionId, review.id);
  return { ok: true, data: { reviewId: review.id }, message: "Reviewer added" };
}

/**
 * Remove a review (e.g. an unhelpful or inappropriate one). A replacement
 * reviewer is assigned when someone is available; the removed reviewer is
 * never paired with this submission again.
 */
export async function removePeerReviewAction(reviewId: string): Promise<ActionResult<{ replaced: boolean }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { user } = auth;
  const id = typeof reviewId === "string" ? reviewId : "";
  const now = Date.now();

  const outcome = await mutate((d) => {
    const row = d.peerReviews.find((r) => r.id === id);
    if (!row) return null;
    d.peerReviews = d.peerReviews.filter((r) => r.id !== id);
    const assignment = d.assignments.find((a) => a.id === row.assignmentId);
    const config = excludePair(d, row.assignmentId, { submissionId: row.submissionId, reviewerId: row.reviewerId });
    // Replace it straight away when a classmate is free; the rest of the plan is left to the next regular allocation.
    const plan = assignment && config ? planForAssignment(d, assignment, config, now).filter((p) => p.submissionId === row.submissionId) : [];
    const created = plan.slice(0, 1).map((p) => {
      const review: PeerReview = { id: uid("prv"), submissionId: p.submissionId, reviewerId: p.reviewerId, assignmentId: row.assignmentId, comment: "", status: "assigned", assignedAt: new Date(now).toISOString() };
      d.peerReviews.push(review);
      return review;
    });
    return { removed: { ...row }, created };
  });
  if (!outcome) return { ok: false, error: "This review no longer exists." };
  await notifyNewReviews(outcome.created.map((r) => ({ id: r.id, reviewerId: r.reviewerId, assignmentId: r.assignmentId, assignedAt: r.assignedAt })));
  await audit(user, "peer_review.remove", { type: "peer_review", id }, { submissionId: outcome.removed.submissionId, reviewerId: outcome.removed.reviewerId, status: outcome.removed.status });
  if (outcome.removed.status === "assigned") await completeLessonsAfterPeerReview({ assignmentIds: [outcome.removed.assignmentId] });
  revalidatePeer(outcome.removed.assignmentId, outcome.removed.submissionId, id);
  const replaced = outcome.created.length > 0;
  return { ok: true, data: { replaced }, message: replaced ? "Review removed and a new reviewer was assigned" : "Review removed. No other classmate was available to replace it." };
}

/* ------------------------------------------------------------------ */
/* Instructor: allocation and reminders                                */
/* ------------------------------------------------------------------ */

/** Hand out reviews now, even before the submission deadline. */
export async function allocatePeerReviewsNowAction(assignmentId: string): Promise<ActionResult<{ created: number }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment || !activePeerConfig(assignment)) return { ok: false, error: "Peer review is off for this assignment." };
  const created = await syncPeerAssignments({ assignmentIds: [assignment.id], force: true });
  await audit(auth.user, "peer_review.allocate", { type: "assignment", id: assignment.id }, { created });
  revalidatePeer(assignment.id);
  return {
    ok: true,
    data: { created },
    message: created ? `${created} review${created === 1 ? "" : "s"} handed out` : "Everyone already has their reviews. At least two learners must submit before reviews can be handed out.",
  };
}

/** Nudge every reviewer with open reviews on this assignment (at most once a day each). */
export async function remindPendingReviewersAction(assignmentId: string): Promise<ActionResult<{ reminded: number }>> {
  const auth = await requireStaff();
  if ("error" in auth) return { ok: false, error: auth.error };
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  const config = assignment ? activePeerConfig(assignment) : null;
  if (!assignment || !config) return { ok: false, error: "Peer review is off for this assignment." };
  const open = db.peerReviews.filter((r) => r.assignmentId === assignment.id && r.status === "assigned");
  if (!open.length) return { ok: false, error: "There are no open reviews to remind anyone about." };
  const day = toDateKey();
  const keyFor = (reviewId: string) => `peer-nudge:${reviewId}:${day}`;
  const already = new Set(db.notifications.filter((n) => n.dedupeKey?.startsWith("peer-nudge:")).map((n) => `${n.userId}\u0000${n.dedupeKey}`));
  const due = open.filter((r) => !already.has(`${r.reviewerId}\u0000${keyFor(r.id)}`));
  for (const r of due) {
    await notify(r.reviewerId, {
      type: "assignment_graded",
      subject: `Reminder from your instructor: review a classmate's work on ${assignment.title}`,
      message: `Please submit your review by ${formatDate(reviewDueAt(r.assignedAt, config.dueDays))}.`,
      link: `/peer-reviews/${r.id}`,
      fromUserId: auth.user.id,
      dedupeKey: keyFor(r.id),
    });
  }
  const reminded = due.length;
  await audit(auth.user, "peer_review.remind", { type: "assignment", id: assignment.id }, { reminded });
  revalidatePeer(assignment.id);
  return {
    ok: true,
    data: { reminded },
    message: reminded ? `Sent ${reminded} reminder${reminded === 1 ? "" : "s"}` : "Everyone with an open review was already reminded today.",
  };
}
