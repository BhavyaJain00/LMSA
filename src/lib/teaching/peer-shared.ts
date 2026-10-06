import type { Assignment, PeerReview, PeerReviewSettings, User } from "@/lib/types";
import { seededShuffle } from "@/lib/utils";

/**
 * Peer review rules shared by the server and the client: configuration
 * defaults, the fair allocation algorithm, due dates and reminder stages.
 * Pure functions only (no store access) so they can be unit tested.
 */

export interface PeerPair {
  submissionId: string;
  reviewerId: string;
}

/**
 * Peer review settings of an assignment. Two fields are stored alongside the
 * typed `PeerReviewSettings` ones:
 * - `requiredForCompletion` (off by default): a learner's lesson counts as
 *   complete only once their assigned reviews are in.
 * - `excluded`: reviewer/submission pairs an instructor took apart (removed
 *   or reassigned), which automatic allocation must never recreate.
 */
export interface PeerConfig extends PeerReviewSettings {
  requiredForCompletion?: boolean;
  excluded?: PeerPair[];
}

/** A peer review row plus the instructor-override markers stored with it. */
export type PeerReviewRecord = PeerReview & {
  /** Staff member who last edited the review in place of the reviewer. */
  overriddenById?: string;
  overriddenAt?: string;
};

export const PEER_LIMITS = {
  reviewsMin: 1,
  reviewsMax: 5,
  dueDaysMin: 1,
  dueDaysMax: 30,
  commentMin: 20,
  commentMax: 5000,
  /** Remembered instructor exclusions per assignment (oldest are dropped first). */
  excludedMax: 500,
} as const;

export const DEFAULT_PEER_CONFIG: PeerConfig = {
  enabled: false,
  reviewsPerSubmission: 2,
  dueDays: 5,
  anonymous: true,
  requiredForCompletion: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A reminder goes out when a review is due within this window. */
export const DUE_SOON_MS = DAY_MS;
/** Overdue reminders stop after this long (no nagging about stale work). */
export const OVERDUE_REMINDER_WINDOW_MS = 14 * DAY_MS;
/**
 * In rolling mode (no deadline) a submission still short of reviewers after
 * this long may be given to reviewers who already have a full load, so the
 * last learners to submit are not left without feedback.
 */
export const ROLLING_OVERFLOW_AFTER_MS = 2 * DAY_MS;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  // null, "" and other non-numbers fall back to the default instead of becoming 0.
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Stored settings merged over the defaults and clamped to the limits. */
export function normalizePeerConfig(raw: Partial<PeerConfig> | null | undefined): PeerConfig {
  const r = raw ?? {};
  const excluded = (Array.isArray(r.excluded) ? r.excluded : [])
    .filter((p): p is PeerPair => !!p && typeof p.submissionId === "string" && typeof p.reviewerId === "string")
    .map((p) => ({ submissionId: p.submissionId, reviewerId: p.reviewerId }))
    .slice(-PEER_LIMITS.excludedMax);
  return {
    enabled: r.enabled === true,
    reviewsPerSubmission: clampInt(r.reviewsPerSubmission, PEER_LIMITS.reviewsMin, PEER_LIMITS.reviewsMax, DEFAULT_PEER_CONFIG.reviewsPerSubmission),
    dueDays: clampInt(r.dueDays, PEER_LIMITS.dueDaysMin, PEER_LIMITS.dueDaysMax, DEFAULT_PEER_CONFIG.dueDays),
    anonymous: r.anonymous !== false,
    requiredForCompletion: r.requiredForCompletion === true,
    ...(excluded.length ? { excluded } : {}),
  };
}

/**
 * Anonymity is a promise made to the people who already wrote or received
 * reviews: once an anonymous assignment has handed out any review, it can't be
 * switched off again (labels are built from the current setting, so turning it
 * off would reveal every name). Turning it on is always allowed.
 */
export function isAnonymityLocked(current: Pick<PeerConfig, "anonymous">, reviewCount: number): boolean {
  return current.anonymous && reviewCount > 0;
}

/** The anonymity to store: the requested value, unless the current one is locked on. */
export function nextAnonymity(current: Pick<PeerConfig, "anonymous">, reviewCount: number, requested: boolean): boolean {
  return isAnonymityLocked(current, reviewCount) ? true : requested;
}

/** `excluded` with one more pair (no duplicates, capped). */
export function withExcludedPair(excluded: readonly PeerPair[] | undefined, pair: PeerPair): PeerPair[] {
  const rest = (excluded ?? []).filter((p) => p.submissionId !== pair.submissionId || p.reviewerId !== pair.reviewerId);
  return [...rest, { submissionId: pair.submissionId, reviewerId: pair.reviewerId }].slice(-PEER_LIMITS.excludedMax);
}

/** Peer settings of an assignment, or null when peer review is off. */
export function activePeerConfig(assignment: Pick<Assignment, "peerReview">): PeerConfig | null {
  const config = normalizePeerConfig(assignment.peerReview as PeerConfig | undefined);
  return config.enabled ? config : null;
}

/**
 * Who takes part in peer review: enabled accounts without a staff role.
 * Staff grade and moderate reviews instead of exchanging them, so their own
 * (test) submissions are neither reviewed nor given reviews to write.
 */
export function takesPartInPeerReview(user: Pick<User, "roles"> & { enabled?: boolean }): boolean {
  return user.enabled !== false && user.roles.every((role) => role === "student");
}

/**
 * When reviews are handed out. With a submission deadline (scheduling on and
 * an end time) everyone is allocated at once after the deadline; otherwise
 * reviews are handed out continuously as learners submit.
 */
export type AllocationMode = "deadline" | "rolling";

export function allocationMode(assignment: Pick<Assignment, "enableScheduling" | "scheduleEnd">): AllocationMode {
  return assignment.enableScheduling && assignment.scheduleEnd ? "deadline" : "rolling";
}

/** Whether reviews may be allocated now (the due point has been reached). */
export function allocationOpen(assignment: Pick<Assignment, "enableScheduling" | "scheduleEnd">, now: number): boolean {
  if (allocationMode(assignment) === "rolling") return true;
  const end = new Date(assignment.scheduleEnd!).getTime();
  return Number.isNaN(end) || now >= end;
}

/* ------------------------------------------------------------------ */
/* Allocation                                                          */
/* ------------------------------------------------------------------ */

export interface PeerSubmission {
  id: string;
  authorId: string;
  /** ISO time; earlier submissions are served first on ties. */
  submittedAt: string;
}

export interface PeerPlanInput {
  submissions: readonly PeerSubmission[];
  /** Reviews that already exist (any status). */
  existing: readonly PeerPair[];
  /** Target number of reviews per submission (and per reviewer). */
  reviewsPerSubmission: number;
  /** Stable seed (e.g. the assignment id) so allocation is reproducible. */
  seed: string;
  /** Submissions that may be given to reviewers who already have a full load. */
  overflow?: ReadonlySet<string>;
  /**
   * Pairs that must not be created: reviews an instructor removed or
   * reassigned. Their reviewers are not given make-up reviews either (they
   * still take submissions that need a reviewer).
   */
  exclude?: readonly PeerPair[];
  /**
   * Who may review. Defaults to the authors of `submissions`; pass a subset
   * to leave out disabled accounts.
   */
  reviewers?: ReadonlySet<string>;
}

const pairKey = (submissionId: string, reviewerId: string) => `${submissionId}\u0000${reviewerId}`;

/** Reviews each submission (and each reviewer) should get with `n` submitters: never more than n - 1. */
export function effectiveReviewCount(submitters: number, reviewsPerSubmission: number): number {
  return Math.max(0, Math.min(Math.floor(reviewsPerSubmission), submitters - 1));
}

/**
 * Decide which new reviews to create.
 *
 * - First allocation (nothing exists yet): balanced round-robin over a
 *   seeded shuffle — submitter i reviews the next k submissions in the
 *   circle, so every submission gets exactly k reviews, every reviewer does
 *   exactly k, and nobody reviews their own work.
 * - Later calls top up incrementally (new submissions in rolling mode, a
 *   removed reviewer), in two passes:
 *   1. repeatedly take the submission with the fewest reviews (below k) and
 *      give it to the eligible reviewer with the lightest load, never
 *      exceeding k per reviewer unless the submission is in `overflow`;
 *   2. every submitter still below k reviews to write gets the submissions
 *      with the fewest reviews so far, but only those still below k. A
 *      learner who submits after everyone else is covered is therefore left
 *      short until the next classmate submits (pass 1 then pairs them up),
 *      instead of piling extra reviews onto the earliest submissions. Once
 *      the reviewer's own submission is in `overflow` (it waited long
 *      enough, or the deadline passed) this cap is lifted, so nobody is
 *      left without reviews to write for good.
 *
 * In rolling mode this keeps every submission at no more than k reviews and
 * every reviewer at no more than k to write until `overflow` kicks in; the
 * last few submitters are the ones who wait.
 *
 * k = min(reviewsPerSubmission, submitters - 1), so a cohort of one gets no
 * reviews and a cohort of two review each other once.
 */
export function planPeerAssignments(input: PeerPlanInput): PeerPair[] {
  // One submission per author (the store guarantees it; stay safe anyway).
  const byAuthor = new Map<string, PeerSubmission>();
  for (const s of input.submissions) if (!byAuthor.has(s.authorId)) byAuthor.set(s.authorId, s);
  const submissions = seededShuffle([...byAuthor.values()].sort((a, b) => a.id.localeCompare(b.id)), input.seed);
  const reviewers = input.reviewers ?? new Set(submissions.map((s) => s.authorId));
  const pool = submissions.filter((s) => reviewers.has(s.authorId));
  const k = effectiveReviewCount(pool.length, input.reviewsPerSubmission);
  if (k <= 0 || submissions.length === 0) return [];

  const ids = new Set(submissions.map((s) => s.id));
  const existing = input.existing.filter((p) => ids.has(p.submissionId));
  const excluded = new Set((input.exclude ?? []).map((p) => pairKey(p.submissionId, p.reviewerId)));

  // Fresh allocation of a fully eligible cohort: exact round-robin.
  if (existing.length === 0 && excluded.size === 0 && pool.length === submissions.length) {
    const n = submissions.length;
    const out: PeerPair[] = [];
    for (let i = 0; i < n; i++) {
      for (let step = 1; step <= k; step++) out.push({ reviewerId: submissions[i]!.authorId, submissionId: submissions[(i + step) % n]!.id });
    }
    return out;
  }

  const rank = new Map(submissions.map((s, i) => [s.authorId, i]));
  const taken = new Set(existing.map((p) => pairKey(p.submissionId, p.reviewerId)));
  const received = new Map<string, number>(submissions.map((s) => [s.id, 0]));
  const load = new Map<string, number>(pool.map((s) => [s.authorId, 0]));
  for (const p of existing) {
    received.set(p.submissionId, (received.get(p.submissionId) ?? 0) + 1);
    if (load.has(p.reviewerId)) load.set(p.reviewerId, load.get(p.reviewerId)! + 1);
  }

  const out: PeerPair[] = [];
  const stuck = new Set<string>();
  const order = (a: PeerSubmission, b: PeerSubmission) =>
    received.get(a.id)! - received.get(b.id)! || a.submittedAt.localeCompare(b.submittedAt) || rank.get(a.authorId)! - rank.get(b.authorId)!;

  for (;;) {
    const open = submissions.filter((s) => !stuck.has(s.id) && received.get(s.id)! < k);
    if (!open.length) break;
    open.sort(order);
    const target = open[0]!;
    const canOverflow = input.overflow?.has(target.id) ?? false;
    let best: string | null = null;
    for (const r of pool) {
      const reviewerId = r.authorId;
      if (reviewerId === target.authorId) continue;
      const key = pairKey(target.id, reviewerId);
      if (taken.has(key) || excluded.has(key)) continue;
      const current = load.get(reviewerId)!;
      if (current >= k && !canOverflow) continue;
      if (best === null || current < load.get(best)! || (current === load.get(best)! && rank.get(reviewerId)! < rank.get(best)!)) best = reviewerId;
    }
    if (best === null) {
      stuck.add(target.id);
      continue;
    }
    taken.add(pairKey(target.id, best));
    received.set(target.id, received.get(target.id)! + 1);
    load.set(best, load.get(best)! + 1);
    out.push({ submissionId: target.id, reviewerId: best });
  }

  // Pass 2: submitters who still have fewer than k reviews to write.
  const benched = new Set((input.exclude ?? []).map((p) => p.reviewerId));
  const idle = new Set<string>();
  for (;;) {
    let reviewer: PeerSubmission | null = null;
    for (const r of pool) {
      if (idle.has(r.authorId) || benched.has(r.authorId) || load.get(r.authorId)! >= k) continue;
      if (reviewer === null || load.get(r.authorId)! < load.get(reviewer.authorId)!) reviewer = r;
    }
    if (reviewer === null) break;
    const reviewerId = reviewer.authorId;
    // Only submissions still short of k, so early work is not reviewed far more often than
    // configured; once the reviewer's own submission has waited long enough (or the deadline
    // passed) they get their full share regardless.
    const uncapped = input.overflow?.has(reviewer.id) ?? false;
    const candidates = submissions.filter((s) => {
      if (s.authorId === reviewerId) return false;
      if (!uncapped && received.get(s.id)! >= k) return false;
      const key = pairKey(s.id, reviewerId);
      return !taken.has(key) && !excluded.has(key);
    });
    if (!candidates.length) {
      idle.add(reviewerId);
      continue;
    }
    const target = candidates.sort(order)[0]!;
    taken.add(pairKey(target.id, reviewerId));
    received.set(target.id, received.get(target.id)! + 1);
    load.set(reviewerId, load.get(reviewerId)! + 1);
    out.push({ submissionId: target.id, reviewerId });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Due dates, reminders, labels                                        */
/* ------------------------------------------------------------------ */

export function reviewDueAt(assignedAt: string, dueDays: number): string {
  const start = new Date(assignedAt).getTime();
  return new Date((Number.isNaN(start) ? Date.now() : start) + dueDays * DAY_MS).toISOString();
}

export function isOverdue(review: Pick<PeerReview, "status" | "assignedAt">, dueDays: number, now: number): boolean {
  return review.status === "assigned" && new Date(reviewDueAt(review.assignedAt, dueDays)).getTime() < now;
}

export type ReminderStage = "due_soon" | "overdue";

/** Which reminder (if any) an open review should get at `now`. */
export function reminderStage(review: Pick<PeerReview, "status" | "assignedAt">, dueDays: number, now: number): ReminderStage | null {
  if (review.status !== "assigned") return null;
  const due = new Date(reviewDueAt(review.assignedAt, dueDays)).getTime();
  if (now > due) return now - due <= OVERDUE_REMINDER_WINDOW_MS ? "overdue" : null;
  // Only when the reviewer had some time already (not for reviews assigned with less than a day left).
  const assigned = new Date(review.assignedAt).getTime();
  return due - now <= DUE_SOON_MS && now - assigned >= DUE_SOON_MS / 2 ? "due_soon" : null;
}

/** Idempotency key of a reminder notification (one per review and stage). */
export function reminderKey(reviewId: string, stage: ReminderStage): string {
  return `peer-${stage === "overdue" ? "overdue" : "due"}:${reviewId}`;
}

/** Name shown for the n-th (0-based) reviewer of a submission when reviews are anonymous. */
export function anonymousReviewerLabel(index: number): string {
  return `Peer reviewer ${index + 1}`;
}

export const ANONYMOUS_AUTHOR_LABEL = "Anonymous classmate";

/* ------------------------------------------------------------------ */
/* Lesson completion                                                   */
/* ------------------------------------------------------------------ */

export type PeerCompletionBlock =
  /** The learner still has reviews to write. */
  | { reason: "reviews_open"; pending: number }
  /** The learner submitted, but their reviews have not been handed out yet. */
  | { reason: "awaiting_reviews" };

/**
 * Why peer review still holds back a learner's lesson completion for one
 * assignment, or null when it does not (setting off, nothing submitted,
 * every assigned review written, or nobody turned up to be reviewed).
 *
 * After submitting, a learner waits for their reviews to be handed out: until
 * the submission deadline in deadline mode, and for at most
 * `ROLLING_OVERFLOW_AFTER_MS` in rolling mode, so a learner without
 * classmates is never stuck.
 */
export function peerCompletionBlock(
  assignment: Pick<Assignment, "peerReview" | "enableScheduling" | "scheduleEnd">,
  mine: { submittedAt: string | null; reviews: readonly Pick<PeerReview, "status">[] },
  now: number,
): PeerCompletionBlock | null {
  if (!activePeerConfig(assignment)?.requiredForCompletion || !mine.submittedAt) return null;
  const pending = mine.reviews.filter((r) => r.status === "assigned").length;
  if (pending > 0) return { reason: "reviews_open", pending };
  if (mine.reviews.length > 0) return null;
  if (!allocationOpen(assignment, now)) return { reason: "awaiting_reviews" };
  if (allocationMode(assignment) === "deadline") return null;
  const submitted = new Date(mine.submittedAt).getTime();
  return !Number.isNaN(submitted) && now - submitted < ROLLING_OVERFLOW_AFTER_MS ? { reason: "awaiting_reviews" } : null;
}

export function peerCompletionMessage(block: PeerCompletionBlock): string {
  return block.reason === "reviews_open"
    ? `Submit your ${block.pending === 1 ? "peer review" : `${block.pending} peer reviews`}`
    : "Wait for your peer reviews to be handed out";
}

/**
 * Completion requirements a learner still has to meet because of peer review,
 * for the assignments a lesson embeds (empty when nothing is missing). Meant
 * for `getCompletionRequirements`: push the result onto `missing`. Members
 * who do not take part in peer review (staff) are never held back.
 */
export function peerReviewRequirements(
  data: {
    assignments: readonly Pick<Assignment, "id" | "peerReview" | "enableScheduling" | "scheduleEnd">[];
    assignmentSubmissions: readonly { assignmentId: string; userId: string; submittedAt: string }[];
    peerReviews: readonly Pick<PeerReview, "assignmentId" | "reviewerId" | "status">[];
  },
  user: Pick<User, "id" | "roles">,
  assignmentIds: readonly string[],
  now: number,
): string[] {
  if (!takesPartInPeerReview(user)) return [];
  const userId = user.id;
  const missing: string[] = [];
  for (const assignment of data.assignments) {
    if (!assignmentIds.includes(assignment.id) || !activePeerConfig(assignment)?.requiredForCompletion) continue;
    const submission = data.assignmentSubmissions.find((s) => s.assignmentId === assignment.id && s.userId === userId);
    const reviews = data.peerReviews.filter((r) => r.assignmentId === assignment.id && r.reviewerId === userId);
    const block = peerCompletionBlock(assignment, { submittedAt: submission?.submittedAt ?? null, reviews }, now);
    if (block) missing.push(peerCompletionMessage(block));
  }
  return missing;
}
