import type { Assignment, PeerReview, PeerReviewSettings } from "@/lib/types";
import { seededShuffle } from "@/lib/utils";

/**
 * Peer review rules shared by the server and the client: configuration
 * defaults, the fair allocation algorithm, due dates and reminder stages.
 * Pure functions only (no store access) so they can be unit tested.
 */

/**
 * Peer review settings of an assignment. `requiredForCompletion` is stored
 * alongside the typed `PeerReviewSettings` fields (off by default): when on,
 * a learner's lesson counts as complete only once their assigned reviews are in.
 */
export interface PeerConfig extends PeerReviewSettings {
  requiredForCompletion?: boolean;
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
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Stored settings merged over the defaults and clamped to the limits. */
export function normalizePeerConfig(raw: Partial<PeerConfig> | null | undefined): PeerConfig {
  const r = raw ?? {};
  return {
    enabled: r.enabled === true,
    reviewsPerSubmission: clampInt(r.reviewsPerSubmission, PEER_LIMITS.reviewsMin, PEER_LIMITS.reviewsMax, DEFAULT_PEER_CONFIG.reviewsPerSubmission),
    dueDays: clampInt(r.dueDays, PEER_LIMITS.dueDaysMin, PEER_LIMITS.dueDaysMax, DEFAULT_PEER_CONFIG.dueDays),
    anonymous: r.anonymous !== false,
    requiredForCompletion: r.requiredForCompletion === true,
  };
}

/** Peer settings of an assignment, or null when peer review is off. */
export function activePeerConfig(assignment: Pick<Assignment, "peerReview">): PeerConfig | null {
  const config = normalizePeerConfig(assignment.peerReview as PeerConfig | undefined);
  return config.enabled ? config : null;
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

export interface PeerPair {
  submissionId: string;
  reviewerId: string;
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
  /** Pairs that must not be created (e.g. a reviewer an instructor just removed). */
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
 *   removed reviewer): repeatedly take the submission with the fewest
 *   reviews and give it to the eligible reviewer with the lightest load,
 *   never exceeding k per reviewer unless the submission is in `overflow`.
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

/**
 * Open reviews that still block a learner's lesson completion: the reviews
 * assigned to `userId` on assignments whose peer settings require them.
 */
export function pendingRequiredReviews(
  data: { assignments: readonly Pick<Assignment, "id" | "peerReview">[]; peerReviews: readonly Pick<PeerReview, "assignmentId" | "reviewerId" | "status">[] },
  userId: string,
  assignmentIds: readonly string[],
): number {
  const required = new Set(
    data.assignments.filter((a) => assignmentIds.includes(a.id) && activePeerConfig(a)?.requiredForCompletion).map((a) => a.id),
  );
  if (!required.size) return 0;
  return data.peerReviews.filter((r) => r.reviewerId === userId && r.status === "assigned" && required.has(r.assignmentId)).length;
}
