import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PEER_CONFIG,
  OVERDUE_REMINDER_WINDOW_MS,
  PEER_LIMITS,
  ROLLING_OVERFLOW_AFTER_MS,
  activePeerConfig,
  allocationMode,
  allocationOpen,
  anonymousReviewerLabel,
  effectiveReviewCount,
  isOverdue,
  normalizePeerConfig,
  peerCompletionBlock,
  peerCompletionMessage,
  peerReviewRequirements,
  planPeerAssignments,
  reminderKey,
  reminderStage,
  reviewDueAt,
  takesPartInPeerReview,
  withExcludedPair,
  type PeerPair,
  type PeerSubmission,
} from "@/lib/teaching/peer-shared";

/** Peer review rules: the fair allocation algorithm, due dates, reminders and the completion gate. */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-03-02T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** `n` submissions by `n` different learners, one minute apart. */
function cohort(n: number): PeerSubmission[] {
  return Array.from({ length: n }, (_, i) => ({ id: `sub_${String(i + 1).padStart(2, "0")}`, authorId: `usr_${String(i + 1).padStart(2, "0")}`, submittedAt: iso(T0 + i * 60_000) }));
}

function tally(submissions: readonly PeerSubmission[], pairs: readonly PeerPair[]) {
  const received = new Map(submissions.map((s) => [s.id, 0]));
  const load = new Map(submissions.map((s) => [s.authorId, 0]));
  for (const p of pairs) {
    received.set(p.submissionId, (received.get(p.submissionId) ?? 0) + 1);
    load.set(p.reviewerId, (load.get(p.reviewerId) ?? 0) + 1);
  }
  return { received, load };
}

/** Nobody reviews their own work and no reviewer gets the same submission twice. */
function assertSound(submissions: readonly PeerSubmission[], pairs: readonly PeerPair[]) {
  const authorOf = new Map(submissions.map((s) => [s.id, s.authorId]));
  const seen = new Set<string>();
  for (const p of pairs) {
    assert.ok(authorOf.has(p.submissionId), `unknown submission ${p.submissionId}`);
    assert.notEqual(authorOf.get(p.submissionId), p.reviewerId, `${p.reviewerId} must not review their own submission`);
    const key = `${p.submissionId}|${p.reviewerId}`;
    assert.ok(!seen.has(key), `duplicate pair ${key}`);
    seen.add(key);
  }
}

describe("first allocation (balanced round-robin)", () => {
  it("gives every submission and every reviewer exactly k reviews", () => {
    for (let n = 2; n <= 12; n++) {
      for (let wanted = 1; wanted <= 5; wanted++) {
        const submissions = cohort(n);
        const pairs = planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: wanted, seed: `asg_${n}_${wanted}` });
        const k = Math.min(wanted, n - 1);
        assertSound(submissions, pairs);
        assert.equal(pairs.length, n * k);
        const { received, load } = tally(submissions, pairs);
        for (const s of submissions) {
          assert.equal(received.get(s.id), k, `n=${n} k=${wanted}: ${s.id} is reviewed ${k} times`);
          assert.equal(load.get(s.authorId), k, `n=${n} k=${wanted}: ${s.authorId} writes ${k} reviews`);
        }
      }
    }
  });

  it("handles small cohorts", () => {
    assert.deepEqual(planPeerAssignments({ submissions: [], existing: [], reviewsPerSubmission: 3, seed: "a" }), []);
    assert.deepEqual(planPeerAssignments({ submissions: cohort(1), existing: [], reviewsPerSubmission: 3, seed: "a" }), [], "a lone submitter has nobody to review");

    const two = cohort(2);
    const pairs = planPeerAssignments({ submissions: two, existing: [], reviewsPerSubmission: 3, seed: "a" });
    assert.equal(pairs.length, 2, "two learners review each other once, whatever the setting");
    assert.deepEqual(
      pairs.map((p) => `${p.reviewerId}>${p.submissionId}`).sort(),
      ["usr_01>sub_02", "usr_02>sub_01"],
    );

    const three = cohort(3);
    const all = planPeerAssignments({ submissions: three, existing: [], reviewsPerSubmission: 5, seed: "a" });
    assertSound(three, all);
    assert.equal(all.length, 6, "three learners each review the two others");
    assert.equal(effectiveReviewCount(3, 5), 2);
    assert.equal(effectiveReviewCount(1, 2), 0);
    assert.equal(effectiveReviewCount(0, 2), 0);
    assert.equal(effectiveReviewCount(10, 2.9), 2);
  });

  it("is reproducible for a seed and independent of the input order", () => {
    const submissions = cohort(9);
    const a = planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: 3, seed: "asg_x" });
    const b = planPeerAssignments({ submissions: [...submissions].reverse(), existing: [], reviewsPerSubmission: 3, seed: "asg_x" });
    assert.deepEqual(a, b);
    const others = ["asg_1", "asg_2", "asg_3", "asg_4"].map((seed) => JSON.stringify(planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: 3, seed })));
    assert.ok(new Set(others).size > 1, "different assignments shuffle the circle differently");
  });

  it("counts one submission per author", () => {
    const submissions = [...cohort(3), { id: "sub_dup", authorId: "usr_01", submittedAt: iso(T0 + DAY) }];
    const pairs = planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: 2, seed: "a" });
    assert.equal(pairs.length, 6);
    assert.ok(pairs.every((p) => p.submissionId !== "sub_dup"));
  });
});

describe("incremental allocation (rolling submissions)", () => {
  it("keeps every submitter at k reviews to write as learners submit one by one", () => {
    for (const wanted of [1, 2, 3]) {
      const everyone = cohort(10);
      const existing: PeerPair[] = [];
      for (let n = 1; n <= everyone.length; n++) {
        const submissions = everyone.slice(0, n);
        const added = planPeerAssignments({ submissions, existing, reviewsPerSubmission: wanted, seed: "asg_roll" });
        existing.push(...added);
        assertSound(submissions, existing);
        const k = Math.min(wanted, n - 1);
        const { received, load } = tally(submissions, existing);
        for (const s of submissions) assert.equal(load.get(s.authorId), k, `k=${wanted}, ${n} submitted: ${s.authorId} has ${k} reviews to write`);
        // Earlier submissions are covered by the learners who submitted after them.
        for (const s of submissions.slice(0, Math.max(0, n - 1 - k))) assert.ok(received.get(s.id)! >= k, `k=${wanted}, ${n} submitted: ${s.id} has its ${k} reviewers`);
        const counts = [...received.values()];
        assert.equal(counts.reduce((a, b) => a + b, 0), n * k);
      }
      // Planning again without new submissions changes nothing.
      assert.deepEqual(planPeerAssignments({ submissions: everyone, existing, reviewsPerSubmission: wanted, seed: "asg_roll" }), []);
    }
  });

  it("gives the last submitter reviewers once their submission may overflow", () => {
    const submissions = cohort(5);
    const existing = planPeerAssignments({ submissions: submissions.slice(0, 4), existing: [], reviewsPerSubmission: 2, seed: "asg_o" });
    const late = submissions[4]!;

    const first = planPeerAssignments({ submissions, existing, reviewsPerSubmission: 2, seed: "asg_o" });
    assert.ok(first.every((p) => p.reviewerId === late.authorId), "everyone else already has a full load: only the newcomer gets work");
    assert.equal(first.length, 2);
    const waiting = [...existing, ...first];
    assert.equal(tally(submissions, waiting).received.get(late.id), 0);

    const topUp = planPeerAssignments({ submissions, existing: waiting, reviewsPerSubmission: 2, seed: "asg_o", overflow: new Set([late.id]) });
    assertSound(submissions, [...waiting, ...topUp]);
    assert.equal(topUp.length, 2);
    assert.ok(topUp.every((p) => p.submissionId === late.id));
    const { load } = tally(submissions, [...waiting, ...topUp]);
    assert.ok(Math.max(...load.values()) <= 3, "the extra reviews are spread: nobody gets more than one on top");
  });

  it("replaces a removed reviewer without ever recreating the excluded pair", () => {
    const submissions = cohort(6);
    const full = planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: 2, seed: "asg_r" });
    const removed = full[0]!;
    const existing = full.slice(1);

    // Everyone else is at a full load, so nothing happens until the submission may overflow…
    const stuck = planPeerAssignments({ submissions, existing, reviewsPerSubmission: 2, seed: "asg_r", exclude: [removed] });
    assert.deepEqual(stuck, [], "the removed reviewer gets neither this submission nor a make-up review");

    // …and then it goes to someone else.
    const replaced = planPeerAssignments({ submissions, existing, reviewsPerSubmission: 2, seed: "asg_r", exclude: [removed], overflow: new Set([removed.submissionId]) });
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0]!.submissionId, removed.submissionId);
    assert.notEqual(replaced[0]!.reviewerId, removed.reviewerId);
    assertSound(submissions, [...existing, ...replaced]);

    // Without the exclusion the same reviewer would simply be assigned again.
    const again = planPeerAssignments({ submissions, existing, reviewsPerSubmission: 2, seed: "asg_r" });
    assert.deepEqual(again, [removed]);
  });

  it("leaves out learners who may not review", () => {
    const submissions = cohort(4);
    const reviewers = new Set(["usr_01", "usr_02", "usr_03"]);
    const pairs = planPeerAssignments({ submissions, existing: [], reviewsPerSubmission: 2, seed: "asg_s", reviewers });
    assertSound(submissions, pairs);
    assert.ok(pairs.every((p) => reviewers.has(p.reviewerId)));
    const { load } = tally(submissions, pairs);
    for (const id of reviewers) assert.equal(load.get(id), 2);
    assert.equal(load.get("usr_04"), 0);
  });

  it("ignores reviews of submissions that no longer take part", () => {
    const submissions = cohort(3);
    const existing: PeerPair[] = [{ submissionId: "sub_gone", reviewerId: "usr_01" }];
    const pairs = planPeerAssignments({ submissions, existing, reviewsPerSubmission: 2, seed: "asg_g" });
    assert.equal(pairs.length, 6, "the stale review does not count against the reviewer's load");
  });
});

describe("peer review settings", () => {
  it("falls back to the defaults and clamps to the limits", () => {
    assert.deepEqual(normalizePeerConfig(undefined), DEFAULT_PEER_CONFIG);
    assert.equal(DEFAULT_PEER_CONFIG.enabled, false);
    assert.equal(DEFAULT_PEER_CONFIG.requiredForCompletion, false, "reviews do not gate lesson completion unless configured");
    const clamped = normalizePeerConfig({ enabled: true, reviewsPerSubmission: 99, dueDays: 0, anonymous: false, requiredForCompletion: true });
    assert.equal(clamped.reviewsPerSubmission, PEER_LIMITS.reviewsMax);
    assert.equal(clamped.dueDays, PEER_LIMITS.dueDaysMin);
    assert.equal(clamped.anonymous, false);
    assert.equal(clamped.requiredForCompletion, true);
    const junk = normalizePeerConfig({ enabled: "yes", reviewsPerSubmission: "abc", dueDays: null } as never);
    assert.equal(junk.enabled, false);
    assert.equal(junk.reviewsPerSubmission, DEFAULT_PEER_CONFIG.reviewsPerSubmission);
    assert.equal(junk.dueDays, DEFAULT_PEER_CONFIG.dueDays);
    assert.equal(junk.anonymous, true);
  });

  it("is active only when enabled", () => {
    assert.equal(activePeerConfig({}), null);
    assert.equal(activePeerConfig({ peerReview: { enabled: false, reviewsPerSubmission: 2, dueDays: 5, anonymous: true } }), null);
    assert.equal(activePeerConfig({ peerReview: { enabled: true, reviewsPerSubmission: 3, dueDays: 5, anonymous: true } })?.reviewsPerSubmission, 3);
  });

  it("remembers instructor exclusions without duplicates", () => {
    const a = { submissionId: "sub_1", reviewerId: "usr_2" };
    const b = { submissionId: "sub_1", reviewerId: "usr_3" };
    const list = withExcludedPair(withExcludedPair(withExcludedPair(undefined, a), b), a);
    assert.deepEqual(list, [b, a]);
    const kept = normalizePeerConfig({ enabled: true, excluded: [a, { submissionId: 1 } as never, b] });
    assert.deepEqual(kept.excluded, [a, b]);
    assert.equal("excluded" in normalizePeerConfig({ enabled: true, excluded: [] }), false);
    let many: PeerPair[] = [];
    for (let i = 0; i < PEER_LIMITS.excludedMax + 5; i++) many = withExcludedPair(many, { submissionId: `sub_${i}`, reviewerId: "usr_1" });
    assert.equal(many.length, PEER_LIMITS.excludedMax);
    assert.equal(many.at(-1)!.submissionId, `sub_${PEER_LIMITS.excludedMax + 4}`);
  });

  it("hands reviews out at the deadline when there is one, otherwise continuously", () => {
    const deadline = { enableScheduling: true, scheduleEnd: iso(T0) };
    assert.equal(allocationMode(deadline), "deadline");
    assert.equal(allocationOpen(deadline, T0 - 1), false);
    assert.equal(allocationOpen(deadline, T0), true);
    assert.equal(allocationMode({ enableScheduling: false, scheduleEnd: iso(T0) }), "rolling", "an end time without scheduling is ignored");
    assert.equal(allocationMode({ enableScheduling: true }), "rolling");
    assert.equal(allocationOpen({ enableScheduling: false }, T0), true);
    assert.equal(allocationOpen({ enableScheduling: true, scheduleEnd: "not a date" }, T0), true, "a broken date never blocks allocation");
  });
});

describe("due dates and reminders", () => {
  const assignedAt = iso(T0);
  const open = { status: "assigned" as const, assignedAt };

  it("computes the due date from the assignment time", () => {
    assert.equal(reviewDueAt(assignedAt, 5), iso(T0 + 5 * DAY));
    assert.equal(isOverdue(open, 5, T0 + 5 * DAY), false);
    assert.equal(isOverdue(open, 5, T0 + 5 * DAY + 1), true);
    assert.equal(isOverdue({ status: "submitted", assignedAt }, 5, T0 + 30 * DAY), false);
  });

  it("reminds once a review is due within a day, and again when it is overdue", () => {
    assert.equal(reminderStage(open, 5, T0 + 3 * DAY), null);
    assert.equal(reminderStage(open, 5, T0 + 4 * DAY), "due_soon");
    assert.equal(reminderStage(open, 5, T0 + 5 * DAY), "due_soon");
    assert.equal(reminderStage(open, 5, T0 + 5 * DAY + 1), "overdue");
    assert.equal(reminderStage(open, 5, T0 + 5 * DAY + OVERDUE_REMINDER_WINDOW_MS), "overdue");
    assert.equal(reminderStage(open, 5, T0 + 5 * DAY + OVERDUE_REMINDER_WINDOW_MS + 1), null, "stale reviews are not nagged about forever");
    assert.equal(reminderStage({ status: "submitted", assignedAt }, 5, T0 + 6 * DAY), null);
  });

  it("does not remind about a one-day review the moment it is handed out", () => {
    assert.equal(reminderStage(open, 1, T0 + HOUR), null);
    assert.equal(reminderStage(open, 1, T0 + 12 * HOUR), "due_soon");
  });

  it("uses one idempotency key per review and stage", () => {
    assert.equal(reminderKey("prv_1", "due_soon"), "peer-due:prv_1");
    assert.equal(reminderKey("prv_1", "overdue"), "peer-overdue:prv_1");
    assert.equal(anonymousReviewerLabel(0), "Peer reviewer 1");
    assert.equal(anonymousReviewerLabel(2), "Peer reviewer 3");
  });
});

describe("reviews that count toward lesson completion", () => {
  const settings = { enabled: true, reviewsPerSubmission: 2, dueDays: 5, anonymous: true };
  const required = { peerReview: { ...settings, requiredForCompletion: true }, enableScheduling: false } as const;
  const submittedAt = iso(T0);

  it("never blocks unless the option is on", () => {
    const off = { peerReview: settings, enableScheduling: false };
    assert.equal(peerCompletionBlock(off, { submittedAt, reviews: [{ status: "assigned" }] }, T0), null);
    assert.equal(peerCompletionBlock({ peerReview: { ...settings, enabled: false, requiredForCompletion: true } as never, enableScheduling: false }, { submittedAt, reviews: [{ status: "assigned" }] }, T0), null);
    assert.equal(peerCompletionBlock(required, { submittedAt: null, reviews: [] }, T0), null, "not submitted: the assignment requirement covers it");
  });

  it("blocks while reviews are open and clears when they are all in", () => {
    const block = peerCompletionBlock(required, { submittedAt, reviews: [{ status: "assigned" }, { status: "submitted" }, { status: "assigned" }] }, T0 + DAY);
    assert.deepEqual(block, { reason: "reviews_open", pending: 2 });
    assert.equal(peerCompletionMessage(block!), "Submit your 2 peer reviews");
    assert.equal(peerCompletionMessage({ reason: "reviews_open", pending: 1 }), "Submit your peer review");
    assert.equal(peerCompletionBlock(required, { submittedAt, reviews: [{ status: "submitted" }, { status: "submitted" }] }, T0 + DAY), null);
  });

  it("waits for reviews to be handed out, but never forever", () => {
    const waiting = peerCompletionBlock(required, { submittedAt, reviews: [] }, T0 + HOUR);
    assert.deepEqual(waiting, { reason: "awaiting_reviews" });
    assert.match(peerCompletionMessage(waiting!), /handed out/);
    assert.equal(peerCompletionBlock(required, { submittedAt, reviews: [] }, T0 + ROLLING_OVERFLOW_AFTER_MS), null, "nobody else submitted in time");

    const deadline = { ...required, enableScheduling: true, scheduleEnd: iso(T0 + 7 * DAY) };
    assert.deepEqual(peerCompletionBlock(deadline, { submittedAt, reviews: [] }, T0 + 6 * DAY), { reason: "awaiting_reviews" });
    assert.equal(peerCompletionBlock(deadline, { submittedAt, reviews: [] }, T0 + 7 * DAY), null, "after the deadline with nothing assigned, the learner is let through");
  });

  it("lists what is missing for the assignments of a lesson", () => {
    const data = {
      assignments: [
        { id: "asg_req", ...required },
        { id: "asg_opt", peerReview: settings, enableScheduling: false },
        { id: "asg_other", ...required },
      ],
      assignmentSubmissions: [
        { assignmentId: "asg_req", userId: "usr_1", submittedAt },
        { assignmentId: "asg_opt", userId: "usr_1", submittedAt },
        { assignmentId: "asg_other", userId: "usr_1", submittedAt },
        { assignmentId: "asg_req", userId: "usr_2", submittedAt },
      ],
      peerReviews: [
        { assignmentId: "asg_req", reviewerId: "usr_1", status: "assigned" as const },
        { assignmentId: "asg_opt", reviewerId: "usr_1", status: "assigned" as const },
        { assignmentId: "asg_other", reviewerId: "usr_1", status: "assigned" as const },
        { assignmentId: "asg_req", reviewerId: "usr_2", status: "submitted" as const },
      ],
    };
    const now = T0 + DAY;
    const learner = (id: string) => ({ id, roles: ["student" as const] });
    assert.deepEqual(peerReviewRequirements(data, learner("usr_1"), ["asg_req", "asg_opt"], now), ["Submit your peer review"]);
    assert.deepEqual(peerReviewRequirements(data, learner("usr_2"), ["asg_req", "asg_opt"], now), []);
    assert.deepEqual(peerReviewRequirements(data, learner("usr_3"), ["asg_req"], now), [], "a learner who has not submitted is not held back by peer review");
    assert.deepEqual(peerReviewRequirements(data, learner("usr_1"), [], now), []);
    assert.deepEqual(peerReviewRequirements(data, { id: "usr_1", roles: ["student", "course_creator"] }, ["asg_req"], now), [], "staff never take part");
    assert.equal(takesPartInPeerReview({ roles: ["student"] }), true);
    assert.equal(takesPartInPeerReview({ roles: ["student"], enabled: false }), false);
    assert.equal(takesPartInPeerReview({ roles: ["admin"] }), false);
    assert.equal(takesPartInPeerReview({ roles: ["batch_evaluator"] }), false);
  });
});
