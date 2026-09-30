import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { EmailPreferences, EmailSequence, Lead, SequenceEnrollment } from "@/lib/types";
import {
  ENROLLMENT_CSV_HEADER,
  SEQUENCE_LIMITS,
  SEQUENCE_TEMPLATES,
  TRIGGER_GOALS,
  TRIGGER_OPTIONS,
  UNCONFIRMED_GRACE_MS,
  UNCONFIRMED_RETRY_MS,
  canEnroll,
  checkSequence,
  cumulativeDelayHours,
  decideStep,
  defaultGoal,
  describeTrigger,
  enrollmentCsvRows,
  enrollmentStateLabel,
  findSequenceTemplate,
  firstRunAt,
  formatDelay,
  goalReached,
  inactivityDue,
  isSequenceTrigger,
  joinDelay,
  matchesTrigger,
  nextRunAfter,
  parseEnrollmentFilters,
  sequenceGoal,
  splitDelay,
  summarizeEnrollments,
  triggerContext,
  type GoalFacts,
} from "@/lib/comms/sequence-core";
import {
  SWEEP_INTERVAL_MS,
  deleteSequence,
  duplicateSequence,
  enrollInSequences,
  getSequenceReport,
  listSequenceEnrollments,
  listSequences,
  parseSequenceFilters,
  processSequences,
  saveSequence,
  setSequenceActive,
  stopActiveEnrollments,
  stopEnrollment,
  stopReachedGoals,
} from "@/lib/comms/sequences";
import { refreshCampaignStats, runComms, setCommsAutoRun } from "@/lib/comms/runner";
import { recordEmailHit } from "@/lib/comms/tracking";
import { emit, settleEvents } from "@/lib/events";
import { getDb, mutate } from "@/lib/db/store";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** "Now" of the tests: the wall clock, so emails queued during a run are never older than the enrollment they belong to. */
const T0 = Math.floor(Date.now() / 1000) * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("sequence triggers", () => {
  const steps = [{ id: "s1", delayHours: 0, subject: "a", body: "b" }];

  it("knows the five triggers", () => {
    assert.deepEqual(TRIGGER_OPTIONS.map((t) => t.value), ["signup", "lead", "enrollment", "purchase", "inactive"]);
    assert.equal(isSequenceTrigger("purchase"), true);
    assert.equal(isSequenceTrigger("birthday"), false);
    assert.equal(isSequenceTrigger(undefined), false);
  });

  it("starts only active sequences with emails, for the matching event", () => {
    const signup = { trigger: "signup" as const, active: true, steps };
    assert.equal(matchesTrigger(signup, { trigger: "signup" }), true);
    assert.equal(matchesTrigger(signup, { trigger: "enrollment", courseId: "crs_a" }), false);
    assert.equal(matchesTrigger({ ...signup, active: false }, { trigger: "signup" }), false, "switched off");
    assert.equal(matchesTrigger({ ...signup, steps: [] }, { trigger: "signup" }), false, "nothing to send");
  });

  it("limits course sequences to their course", () => {
    const enrollment = { trigger: "enrollment" as const, courseId: "crs_a", active: true, steps };
    assert.equal(matchesTrigger(enrollment, { trigger: "enrollment", courseId: "crs_a" }), true);
    assert.equal(matchesTrigger(enrollment, { trigger: "enrollment", courseId: "crs_b" }), false);
    assert.equal(matchesTrigger({ ...enrollment, courseId: undefined }, { trigger: "enrollment", courseId: "crs_b" }), true, "any course");

    const purchase = { trigger: "purchase" as const, courseId: "crs_a", active: true, steps };
    assert.equal(matchesTrigger(purchase, { trigger: "purchase", itemType: "course", itemId: "crs_a" }), true);
    assert.equal(matchesTrigger(purchase, { trigger: "purchase", itemType: "batch", itemId: "crs_a" }), false, "a batch with the same id is not the course");
    assert.equal(matchesTrigger({ ...purchase, courseId: undefined }, { trigger: "purchase", itemType: "batch", itemId: "bat_1" }), true);

    const lead = { trigger: "lead" as const, courseId: "crs_a", active: true, steps };
    assert.equal(matchesTrigger(lead, { trigger: "lead", courseId: "crs_a" }), true);
    assert.equal(matchesTrigger(lead, { trigger: "lead" }), false, "a lead from the footer form");
  });

  it("derives what makes a trigger unique for a person", () => {
    assert.deepEqual(triggerContext({ trigger: "signup" }), { contextKey: "" });
    assert.deepEqual(triggerContext({ trigger: "lead", courseId: "crs_a" }), { contextKey: "", courseId: "crs_a" });
    assert.deepEqual(triggerContext({ trigger: "enrollment", courseId: "crs_a" }), { contextKey: "course:crs_a", courseId: "crs_a" });
    assert.deepEqual(triggerContext({ trigger: "purchase", itemType: "course", itemId: "crs_a" }), { contextKey: "course:crs_a", courseId: "crs_a" });
    assert.deepEqual(triggerContext({ trigger: "purchase", itemType: "batch", itemId: "bat_1" }), { contextKey: "batch:bat_1", courseId: undefined });
    assert.deepEqual(triggerContext({ trigger: "inactive", lastActivityAt: 1234 }), { contextKey: "inactive:1234" });
  });

  it("never enrolls someone twice for the same trigger, or while they are in the sequence", () => {
    assert.equal(canEnroll([], ""), true);
    assert.equal(canEnroll([{ status: "completed", contextKey: "" }], ""), false, "one-off triggers happen once");
    assert.equal(canEnroll([{ status: "completed" }], ""), false, "rows without a key count as one-off");
    assert.equal(canEnroll([{ status: "completed", contextKey: "course:crs_a" }], "course:crs_b"), true, "another course");
    assert.equal(canEnroll([{ status: "active", contextKey: "course:crs_a" }], "course:crs_b"), false, "still part-way through");
    assert.equal(canEnroll([{ status: "stopped", contextKey: "course:crs_a" }], "course:crs_a"), false);
  });

  it("fires the inactivity trigger when the threshold is crossed while the sequence is on", () => {
    const last = T0 - 30 * DAY;
    assert.equal(inactivityDue(last, 30, T0 - DAY, T0), true, "crossed just now");
    assert.equal(inactivityDue(last, 30, T0 - DAY, T0 - 1), false, "not inactive long enough yet");
    assert.equal(inactivityDue(last - 300 * DAY, 30, T0 - DAY, T0), false, "already dormant when the sequence was switched on");
    assert.equal(inactivityDue(last, 30, T0, T0), true, "crossed at the moment of activation");
  });

  it("describes the trigger for staff", () => {
    const title = (id: string) => (id === "crs_a" ? "Python 101" : undefined);
    assert.equal(describeTrigger({ trigger: "signup" }, title), "When someone creates an account");
    assert.equal(describeTrigger({ trigger: "enrollment", courseId: "crs_a" }, title), "When a learner enrolls in Python 101");
    assert.equal(describeTrigger({ trigger: "enrollment" }, title), "When a learner enrolls in any course");
    assert.equal(describeTrigger({ trigger: "purchase", courseId: "crs_gone" }, title), "When an order for a deleted course is paid");
    assert.equal(describeTrigger({ trigger: "lead" }, title), "When a lead confirms their address");
    assert.equal(describeTrigger({ trigger: "inactive", inactiveDays: 1 }, title), "After 1 day without activity");
    assert.equal(describeTrigger({ trigger: "inactive" }, title), "After 30 days without activity");
  });
});

describe("sequence goals", () => {
  const facts = (overrides: Partial<GoalFacts> = {}): GoalFacts => ({ since: T0, hasAccount: true, payments: [], enrollments: [], ...overrides });

  it("offers goals that make sense for the trigger", () => {
    assert.equal(defaultGoal("lead"), "purchase");
    assert.equal(defaultGoal("inactive"), "return");
    assert.equal(defaultGoal("signup"), "none");
    assert.equal(sequenceGoal({ trigger: "lead", goal: "purchase" }), "purchase");
    assert.equal(sequenceGoal({ trigger: "signup", goal: "return" }), "none", "a goal the trigger doesn't offer is ignored");
    assert.equal(sequenceGoal({ trigger: "signup" }), "none");
    for (const option of TRIGGER_OPTIONS) assert.ok(TRIGGER_GOALS[option.value].includes("none"), `${option.value} can run without a goal`);
  });

  it("purchase: a paid order since the person started", () => {
    assert.equal(goalReached("purchase", facts()), false);
    assert.equal(goalReached("purchase", facts({ payments: [{ status: "pending", createdAt: iso(T0 + HOUR) }] })), false);
    assert.equal(goalReached("purchase", facts({ payments: [{ status: "paid", paidAt: iso(T0 - HOUR), createdAt: iso(T0 - DAY) }] })), false, "bought before the sequence");
    assert.equal(goalReached("purchase", facts({ payments: [{ status: "paid", paidAt: iso(T0 + HOUR), createdAt: iso(T0 - DAY) }] })), true);
    assert.equal(goalReached("purchase", facts({ payments: [{ status: "paid", createdAt: iso(T0) }] })), true, "falls back to the order time");
  });

  it("enrollment: a learner enrollment since the person started", () => {
    const row = { courseId: "crs_a", memberType: "student" as const, enrolledAt: iso(T0 + HOUR) };
    assert.equal(goalReached("enrollment", facts({ enrollments: [row] })), true);
    assert.equal(goalReached("enrollment", facts({ enrollments: [{ ...row, enrolledAt: iso(T0 - HOUR) }] })), false);
    assert.equal(goalReached("enrollment", facts({ enrollments: [{ ...row, memberType: "staff" }] })), false, "being added as staff is not a conversion");
  });

  it("completion: the course of the enrollment, or any course finished since", () => {
    const done = { courseId: "crs_a", memberType: "student" as const, enrolledAt: iso(T0 - DAY), completedAt: iso(T0 - HOUR) };
    assert.equal(goalReached("completion", facts({ courseId: "crs_a", enrollments: [done] })), true, "already finished counts for that course");
    assert.equal(goalReached("completion", facts({ courseId: "crs_b", enrollments: [done] })), false);
    assert.equal(goalReached("completion", facts({ enrollments: [done] })), false, "without a course only completions since the start count");
    assert.equal(goalReached("completion", facts({ enrollments: [{ ...done, completedAt: iso(T0 + HOUR) }] })), true);
    assert.equal(goalReached("completion", facts({ courseId: "crs_a", enrollments: [{ ...done, completedAt: undefined }] })), false);
  });

  it("signup, return and no goal", () => {
    assert.equal(goalReached("signup", facts({ hasAccount: false })), false);
    assert.equal(goalReached("signup", facts()), true);
    assert.equal(goalReached("return", facts({ lastActivityAt: T0 })), false, "the activity that started it doesn't count");
    assert.equal(goalReached("return", facts({ lastActivityAt: T0 + 1 })), true);
    assert.equal(goalReached("return", facts()), false);
    assert.equal(goalReached("none", facts({ payments: [{ status: "paid", createdAt: iso(T0 + 1) }] })), false);
  });
});

describe("sequence scheduling math", () => {
  const steps = [{ delayHours: 0 }, { delayHours: 48 }, { delayHours: 72 }];

  it("schedules the first step from the trigger", () => {
    assert.equal(firstRunAt(steps, T0), T0);
    assert.equal(firstRunAt([{ delayHours: 24 }], T0), T0 + DAY);
    assert.equal(firstRunAt([], T0), T0);
  });

  it("counts each delay from the moment the previous step was sent", () => {
    assert.equal(nextRunAfter(steps, 0, T0), T0 + 48 * HOUR);
    const sentLate = T0 + 48 * HOUR + 5 * HOUR;
    assert.equal(nextRunAfter(steps, 1, sentLate), sentLate + 72 * HOUR, "a late step pushes the next one back, so steps never bunch up");
    assert.equal(nextRunAfter(steps, 2, T0), null, "the last step has no successor");
  });

  it("treats junk delays as none and caps them at a year", () => {
    assert.equal(firstRunAt([{ delayHours: -5 }], T0), T0);
    assert.equal(firstRunAt([{ delayHours: Number.NaN }], T0), T0);
    assert.equal(firstRunAt([{ delayHours: 1e9 }], T0), T0 + SEQUENCE_LIMITS.maxDelayHours * HOUR);
  });

  it("adds the delays up for the timeline", () => {
    assert.deepEqual(cumulativeDelayHours(steps), [0, 48, 120]);
    assert.deepEqual(cumulativeDelayHours([]), []);
  });

  it("converts between hours and the form's value + unit", () => {
    assert.deepEqual(splitDelay(72), { value: 3, unit: "days" });
    assert.deepEqual(splitDelay(36), { value: 36, unit: "hours" });
    assert.deepEqual(splitDelay(0), { value: 0, unit: "hours" });
    assert.equal(joinDelay(3, "days"), 72);
    assert.equal(joinDelay(5, "hours"), 5);
    assert.equal(joinDelay(-2, "days"), 0);
    assert.equal(joinDelay(9_999, "days"), SEQUENCE_LIMITS.maxDelayHours);
    for (const hours of [0, 1, 23, 24, 25, 48, 168, 8_760]) {
      const { value, unit } = splitDelay(hours);
      assert.equal(joinDelay(value, unit), hours, `${hours} h round-trips`);
    }
  });

  it("words delays for people", () => {
    assert.equal(formatDelay(0), "immediately");
    assert.equal(formatDelay(1), "1 hour");
    assert.equal(formatDelay(2), "2 hours");
    assert.equal(formatDelay(24), "1 day");
    assert.equal(formatDelay(36), "36 hours");
    assert.equal(formatDelay(48), "2 days");
    assert.equal(formatDelay(49), "2 days 1 hour");
    assert.equal(formatDelay(54), "2 days 6 hours");
    assert.equal(formatDelay(168), "7 days");
  });
});

describe("deciding what happens to an enrollment", () => {
  const steps = [{ id: "s1" }, { id: "s2" }];
  const enrollment = (overrides: Partial<Pick<SequenceEnrollment, "nextStepIndex" | "nextRunAt" | "createdAt">> = {}) => ({ nextStepIndex: 0, nextRunAt: iso(T0), createdAt: iso(T0 - DAY), ...overrides });

  it("sends the step that is due", () => {
    assert.deepEqual(decideStep({ steps, enrollment: enrollment(), block: null, goal: false, now: T0 }), { action: "send", stepIndex: 0 });
    assert.deepEqual(decideStep({ steps, enrollment: enrollment({ nextStepIndex: 1 }), block: null, goal: false, now: T0 + 5 }), { action: "send", stepIndex: 1 });
  });

  it("waits until the step is due", () => {
    assert.deepEqual(decideStep({ steps, enrollment: enrollment({ nextRunAt: iso(T0 + HOUR) }), block: null, goal: false, now: T0 }), { action: "wait", until: T0 + HOUR });
  });

  it("completes when there is no step left (e.g. the remaining emails were removed)", () => {
    assert.deepEqual(decideStep({ steps, enrollment: enrollment({ nextStepIndex: 2 }), block: null, goal: false, now: T0 }), { action: "complete" });
  });

  it("stops for people who unsubscribed, can't be emailed or reached the goal", () => {
    assert.deepEqual(decideStep({ steps, enrollment: enrollment(), block: "unsubscribed", goal: false, now: T0 }), { action: "stop", reason: "unsubscribed" });
    for (const block of ["missing", "disabled", "invalid"] as const) {
      assert.deepEqual(decideStep({ steps, enrollment: enrollment(), block, goal: false, now: T0 }), { action: "stop", reason: "undeliverable" }, block);
    }
    assert.deepEqual(decideStep({ steps, enrollment: enrollment({ nextRunAt: iso(T0 + DAY) }), block: null, goal: true, now: T0 }), { action: "stop", reason: "goal" }, "even before the next step is due");
    assert.deepEqual(decideStep({ steps, enrollment: enrollment(), block: "unsubscribed", goal: true, now: T0 }), { action: "stop", reason: "unsubscribed" }, "an unsubscribe is recorded as such");
  });

  it("holds a step for an unconfirmed address and gives up after two weeks", () => {
    assert.deepEqual(decideStep({ steps, enrollment: enrollment(), block: "unconfirmed", goal: false, now: T0 }), { action: "wait", until: T0 + UNCONFIRMED_RETRY_MS });
    const old = enrollment({ createdAt: iso(T0 - UNCONFIRMED_GRACE_MS - 1) });
    assert.deepEqual(decideStep({ steps, enrollment: old, block: "unconfirmed", goal: false, now: T0 }), { action: "stop", reason: "undeliverable" });
    assert.deepEqual(
      decideStep({ steps, enrollment: enrollment({ nextRunAt: iso(T0 + DAY) }), block: "unconfirmed", goal: false, now: T0 }),
      { action: "wait", until: T0 + DAY },
      "not due yet: nothing to hold",
    );
  });
});

describe("sequence validation", () => {
  const courses = new Set(["crs_a"]);
  const step = (overrides: Record<string, unknown> = {}) => ({ delayHours: 0, subject: "Hello {{ first_name }}", body: "Welcome to {{ site_name }}.", ...overrides });

  it("accepts a valid sequence and normalizes it", () => {
    const result = checkSequence(
      { name: "  Course   onboarding ", description: " Keeps people going ", trigger: "enrollment", courseId: "crs_a", goal: "completion", steps: [step({ id: "step_one", delayHours: "24" }), step({ delayHours: 47.6 })] },
      courses,
    );
    assert.ok(result.ok);
    assert.equal(result.value.name, "Course onboarding");
    assert.equal(result.value.description, "Keeps people going");
    assert.equal(result.value.courseId, "crs_a");
    assert.equal(result.value.goal, "completion");
    assert.equal(result.value.inactiveDays, undefined);
    assert.deepEqual(result.value.steps.map((s) => s.delayHours), [24, 48]);
    assert.equal(result.value.steps[0]!.id, "step_one", "existing step ids are kept (they identify the email in tracking)");
    assert.match(result.value.steps[1]!.id, /^step_/);
  });

  it("requires a name, a trigger and at least one email", () => {
    const result = checkSequence({ name: " ", trigger: "sometimes", steps: [] }, courses);
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys((result as { fieldErrors: Record<string, string> }).fieldErrors).sort(), ["name", "steps", "trigger"]);
    assert.equal(checkSequence({ name: "x".repeat(SEQUENCE_LIMITS.name + 1), trigger: "signup", steps: [step()] }, courses).ok, false);
    const tooMany = checkSequence({ name: "Long", trigger: "signup", steps: Array.from({ length: SEQUENCE_LIMITS.steps + 1 }, () => step()) }, courses);
    assert.match((tooMany as { fieldErrors: Record<string, string> }).fieldErrors.steps ?? "", /at most 20/);
    assert.equal(checkSequence({ name: "Junk", trigger: "signup", steps: "nope" }, courses).ok, false);
  });

  it("points at the email that is wrong", () => {
    const result = checkSequence({ name: "Welcome", trigger: "signup", steps: [step(), step({ body: "Hi {{ frist_name }}" }), step({ subject: "", delayHours: -1 })] }, courses);
    assert.equal(result.ok, false);
    const { error, fieldErrors } = result as { error: string; fieldErrors: Record<string, string> };
    assert.deepEqual(Object.keys(fieldErrors).sort(), ["steps.1.body", "steps.2.delayHours", "steps.2.subject"]);
    assert.match(error, /^Check email 2: Unknown placeholder \{\{ frist_name \}\}/);
    const tooLong = checkSequence({ name: "Welcome", trigger: "signup", steps: [step({ delayHours: SEQUENCE_LIMITS.maxDelayHours + 1 })] }, courses);
    assert.match((tooLong as { fieldErrors: Record<string, string> }).fieldErrors["steps.0.delayHours"] ?? "", /one year/);
  });

  it("allows the course placeholders in sequence emails", () => {
    const result = checkSequence({ name: "Nurture", trigger: "lead", steps: [step({ subject: "About {{ course_title }}", body: "See {{ course_url }}" })] }, courses);
    assert.ok(result.ok);
    assert.equal(result.value.goal, "purchase", "the default goal of a lead sequence");
  });

  it("checks the course and the inactivity period against the trigger", () => {
    const gone = checkSequence({ name: "A", trigger: "purchase", courseId: "crs_gone", steps: [step()] }, courses);
    assert.match((gone as { fieldErrors: Record<string, string> }).fieldErrors.courseId ?? "", /no longer exists/);

    const signup = checkSequence({ name: "A", trigger: "signup", courseId: "crs_gone", inactiveDays: 9, goal: "return", steps: [step()] }, courses);
    assert.ok(signup.ok, "a course and a period are ignored where they don't apply");
    assert.equal(signup.value.courseId, undefined);
    assert.equal(signup.value.inactiveDays, undefined);
    assert.equal(signup.value.goal, "none", "a goal the trigger doesn't offer falls back to its default");

    assert.equal(checkSequence({ name: "A", trigger: "inactive", steps: [step()] }, courses).ok, false);
    assert.equal(checkSequence({ name: "A", trigger: "inactive", inactiveDays: 0, steps: [step()] }, courses).ok, false);
    assert.equal(checkSequence({ name: "A", trigger: "inactive", inactiveDays: SEQUENCE_LIMITS.maxInactiveDays + 1, steps: [step()] }, courses).ok, false);
    const winBack = checkSequence({ name: "A", trigger: "inactive", inactiveDays: "30.9", steps: [step()] }, courses);
    assert.ok(winBack.ok);
    assert.equal(winBack.value.inactiveDays, 30);
    assert.equal(winBack.value.goal, "return");
  });

  it("gives every email its own id", () => {
    const result = checkSequence({ name: "A", trigger: "signup", steps: [step({ id: "same" }), step({ id: "same" }), step({ id: "not valid!" })] }, courses);
    assert.ok(result.ok);
    const ids = result.value.steps.map((s) => s.id);
    assert.equal(ids[0], "same");
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)));
  });

  it("ships templates that pass its own validation", () => {
    assert.ok(SEQUENCE_TEMPLATES.length >= 4);
    assert.equal(new Set(SEQUENCE_TEMPLATES.map((t) => t.key)).size, SEQUENCE_TEMPLATES.length);
    for (const template of SEQUENCE_TEMPLATES) {
      const result = checkSequence({ ...template.draft }, courses);
      assert.ok(result.ok, `${template.key}: ${result.ok ? "" : result.error}`);
      assert.equal(result.value.goal, template.draft.goal, `${template.key} keeps its goal`);
      assert.equal(result.value.steps.length, template.draft.steps.length);
    }
    assert.equal(findSequenceTemplate("lead-nurture")?.draft.trigger, "lead");
    assert.equal(findSequenceTemplate("nope"), null);
    assert.equal(findSequenceTemplate(undefined), null);
  });
});

describe("sequence reporting helpers", () => {
  const rows: SequenceEnrollment[] = [
    { id: "e1", sequenceId: "s", email: "a@example.com", name: "Ada", userId: "u1", nextStepIndex: 1, nextRunAt: iso(T0 + DAY), status: "active", createdAt: iso(T0), sentCount: 1, lastSentAt: iso(T0) },
    { id: "e2", sequenceId: "s", email: "b@example.com", leadId: "l1", nextStepIndex: 2, nextRunAt: iso(T0), status: "completed", createdAt: iso(T0), sentCount: 2, endedAt: iso(T0 + DAY) },
    { id: "e3", sequenceId: "s", email: "c@example.com", userId: "u3", nextStepIndex: 1, nextRunAt: iso(T0), status: "stopped", stopReason: "goal", createdAt: iso(T0), endedAt: iso(T0 + HOUR) },
    { id: "e4", sequenceId: "s", email: "d@example.com", userId: "u4", nextStepIndex: 1, nextRunAt: iso(T0), status: "stopped", stopReason: "unsubscribed", createdAt: iso(T0) },
    { id: "e5", sequenceId: "s", email: "e@example.com", userId: "u5", nextStepIndex: 0, nextRunAt: iso(T0), status: "stopped", createdAt: iso(T0) },
  ];

  it("summarizes where everyone is", () => {
    assert.deepEqual(summarizeEnrollments(rows), { total: 5, active: 1, completed: 1, stopped: 3, goal: 1, unsubscribed: 1, undeliverable: 0, manual: 1, goalRate: 20 });
    assert.equal(summarizeEnrollments([]).goalRate, 0);
  });

  it("labels each state", () => {
    assert.deepEqual(rows.map(enrollmentStateLabel), ["Active", "Completed", "Goal reached", "Unsubscribed", "Stopped by staff"]);
    assert.equal(enrollmentStateLabel({ status: "stopped", stopReason: "undeliverable" }), "Can't be emailed");
  });

  it("parses the people filters defensively", () => {
    assert.deepEqual(parseEnrollmentFilters({}), { status: "all", q: "", page: 1 });
    assert.deepEqual(parseEnrollmentFilters({ status: "stopped", q: "  ada ", page: "3" }), { status: "stopped", q: "ada", page: 3 });
    assert.deepEqual(parseEnrollmentFilters({ status: ["active", "stopped"], page: "-4", q: "x".repeat(500) }), { status: "active", q: "x".repeat(120), page: 1 });
    assert.equal(parseEnrollmentFilters({ status: "deleted", page: "abc" }).status, "all");
    assert.deepEqual(parseSequenceFilters({ status: "paused", q: " win " }), { status: "paused", q: "win" });
    assert.equal(parseSequenceFilters({ status: "draft" }).status, "all");
  });

  it("exports people as CSV rows", () => {
    const csv = enrollmentCsvRows(rows, [{ subject: "First" }, { subject: "Second" }]);
    assert.deepEqual(csv[0], ENROLLMENT_CSV_HEADER);
    assert.equal(csv.length, 6);
    assert.deepEqual(csv[1], ["a@example.com", "Ada", "Member", "Active", "1", "Second", iso(T0 + DAY), iso(T0), iso(T0), ""]);
    assert.deepEqual(csv[2], ["b@example.com", "", "Lead", "Completed", "2", "", "", iso(T0), "", iso(T0 + DAY)], "no next email once finished");
    assert.ok(csv.every((line) => line.length === ENROLLMENT_CSV_HEADER.length));
  });
});

/* ------------------------------------------------------------------ */
/* Server: saving, enrolling, the runner                               */
/* ------------------------------------------------------------------ */

const OPTED_OUT: EmailPreferences = { enrollment: true, announcements: false, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: true };

const admin = makeUser({ id: "usr_admin", name: "Avery Admin", email: "admin@example.com", roles: ["admin"] });
const ada = makeUser({ id: "usr_ada", name: "Ada Lovelace", email: "ada@example.com", createdAt: iso(T0 - 90 * DAY) });
const bob = makeUser({ id: "usr_bob", name: "Bob Stone", email: "bob@example.com", createdAt: iso(T0 - 90 * DAY) });
const python = makeCourse({ id: "crs_py", slug: "python-101", title: "Python 101" });
const rust = makeCourse({ id: "crs_rs", slug: "rust-basics", title: "Rust basics" });

function lead(overrides: Partial<Lead> = {}): Lead {
  return { id: "lead_1", email: "lee@example.org", name: "Lee Lead", source: "course:crs_py", courseId: "crs_py", consent: true, confirmedAt: iso(T0), createdAt: iso(T0 - HOUR), ...overrides };
}

const THREE_STEPS = [
  { delayHours: 0, subject: "Welcome, {{ first_name }}", body: "Hi {{ first_name }},\n\nStart [here](https://example.com/start)." },
  { delayHours: 48, subject: "A good first step", body: "Ten minutes is enough." },
  { delayHours: 72, subject: "Still deciding?", body: "Reply to this email." },
];

/** Create a sequence; it is switched on at `activatedAt` (default: a day before `T0`). */
async function sequence(overrides: Record<string, unknown> = {}, opts: { active?: boolean; activatedAt?: number } = {}): Promise<EmailSequence> {
  const result = await saveSequence(admin, { name: "Welcome series", trigger: "signup", goal: "none", steps: THREE_STEPS, active: opts.active ?? true, ...overrides });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const activatedAt = iso(opts.activatedAt ?? T0 - DAY);
  await mutate((db) => {
    const row = db.emailSequences.find((s) => s.id === result.sequence.id)!;
    if (row.active) row.activatedAt = activatedAt;
  });
  return result.sequence;
}

const enrollmentsOf = async (sequenceId: string) => (await getDb()).sequenceEnrollments.filter((e) => e.sequenceId === sequenceId);
const sequenceEmails = async (sequenceId: string) => (await getDb()).emails.filter((e) => e.trackingId?.startsWith(`sequence:${sequenceId}:`));

function quiet() {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());
}

describe("saving sequences", () => {
  quiet();
  beforeEach(async () => {
    await resetDb({ users: [admin, ada], courses: [python] });
  });

  it("creates a sequence switched off unless asked otherwise, and reports field errors", async () => {
    const bad = await saveSequence(admin, { name: "", trigger: "signup", steps: [] });
    assert.equal(bad.ok, false);
    assert.ok((bad as { fieldErrors?: Record<string, string> }).fieldErrors?.name);

    const created = await saveSequence(admin, { name: "Nurture", trigger: "lead", courseId: "crs_py", steps: THREE_STEPS });
    assert.ok(created.ok);
    assert.match(created.sequence.id, /^seq_/);
    assert.equal(created.sequence.active, false);
    assert.equal(created.sequence.activatedAt, undefined);
    assert.equal(created.sequence.goal, "purchase");
    assert.equal(created.sequence.createdById, admin.id);
    assert.equal((await saveSequence(admin, { name: "Gone", trigger: "lead", courseId: "crs_missing", steps: THREE_STEPS })).ok, false);
  });

  it("switches on and off, but not without emails or while email is off", async () => {
    const s = await sequence({}, { active: false });
    const on = await setSequenceActive(s.id, true);
    assert.ok(on.ok);
    assert.equal(on.sequence.active, true);
    assert.ok(on.sequence.activatedAt, "remembers when it was switched on");
    assert.equal((await setSequenceActive(s.id, false)).ok, true);
    assert.equal((await setSequenceActive("seq_missing", true)).ok, false);

    await mutate((db) => {
      db.emailSequences.find((row) => row.id === s.id)!.steps = [];
    });
    assert.match(((await setSequenceActive(s.id, true)) as { error: string }).error, /at least one email/);

    await resetDb({ users: [admin], settings: { email: { enabled: false } } });
    const other = await sequence({}, { active: false });
    assert.match(((await setSequenceActive(other.id, true)) as { error: string }).error, /Email is turned off/);
  });

  it("keeps people waiting for the same email when steps are reordered, and keeps the sent counters", async () => {
    const s = await sequence();
    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0), 1);
    await processSequences(T0);
    const [first, second, third] = s.steps;
    assert.equal((await enrollmentsOf(s.id))[0]!.nextStepIndex, 1, "waiting for the second email");

    const reordered = await saveSequence(admin, { id: s.id, name: "Welcome series v2", trigger: "signup", goal: "none", steps: [first, { ...third, delayHours: 24 }, second, { delayHours: 5, subject: "New", body: "Fresh" }] });
    assert.ok(reordered.ok);
    assert.equal(reordered.sequence.name, "Welcome series v2");
    assert.deepEqual(reordered.sequence.steps.map((step) => step.id).slice(0, 3), [first!.id, third!.id, second!.id]);
    assert.equal(reordered.sequence.steps[0]!.sent, 1, "statistics follow the email");
    assert.equal(reordered.sequence.active, true, "editing never switches a sequence off");
    assert.equal((await enrollmentsOf(s.id))[0]!.nextStepIndex, 2, "still waiting for the same email, now third");

    const removed = await saveSequence(admin, { id: s.id, name: "Welcome series v2", trigger: "signup", goal: "none", steps: [first] });
    assert.ok(removed.ok);
    const run = await processSequences(T0 + 30 * DAY);
    assert.equal(run.completed, 1, "nothing left to send: the enrollment completes");
    assert.equal(run.sent, 0);
    assert.equal((await saveSequence(admin, { id: "seq_missing", name: "x", trigger: "signup", steps: THREE_STEPS })).ok, false);
  });

  it("duplicates into a switched-off copy without history, and deletes with its enrollments", async () => {
    const s = await sequence({ description: "Greets new members" });
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await processSequences(T0);

    const dup = await duplicateSequence(admin, s.id);
    assert.ok(dup.ok);
    assert.equal(dup.sequence.name, "Welcome series (copy)");
    assert.equal(dup.sequence.description, "Greets new members");
    assert.equal(dup.sequence.active, false);
    assert.deepEqual(dup.sequence.steps.map((step) => step.subject), s.steps.map((step) => step.subject));
    assert.ok(dup.sequence.steps.every((step, i) => step.id !== s.steps[i]!.id && step.sent === undefined), "fresh ids, no counters");
    assert.equal((await enrollmentsOf(dup.sequence.id)).length, 0);

    assert.ok((await deleteSequence(s.id)).ok);
    const db = await getDb();
    assert.deepEqual(db.emailSequences.map((row) => row.id), [dup.sequence.id]);
    assert.equal(db.sequenceEnrollments.length, 0);
    assert.equal((await deleteSequence(s.id)).ok, false);
    assert.equal((await duplicateSequence(admin, s.id)).ok, false);
  });
});

describe("enrolling people in sequences", () => {
  quiet();
  beforeEach(async () => {
    await resetDb({ users: [admin, ada, bob], courses: [python, rust] });
  });

  it("starts every matching active sequence once", async () => {
    const welcome = await sequence();
    const second = await sequence({ name: "Second welcome", steps: [{ delayHours: 24, subject: "Later", body: "Hello" }] });
    await sequence({ name: "Off" }, { active: false });
    await sequence({ name: "Other trigger", trigger: "purchase" });

    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0), 2);
    const [row] = await enrollmentsOf(welcome.id);
    assert.ok(row);
    assert.equal(row.userId, ada.id);
    assert.equal(row.email, "ada@example.com");
    assert.equal(row.name, "Ada Lovelace");
    assert.equal(row.status, "active");
    assert.equal(row.nextStepIndex, 0);
    assert.equal(row.nextRunAt, iso(T0), "no delay on the first email");
    assert.equal(row.contextKey, "");
    assert.equal((await enrollmentsOf(second.id))[0]!.nextRunAt, iso(T0 + DAY), "the first email's delay counts from the trigger");

    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0 + HOUR), 0, "never twice");
    assert.equal((await getDb()).sequenceEnrollments.length, 2);
  });

  it("skips people who can't be emailed, but lets an unverified member in", async () => {
    await sequence();
    await mutate((db) => {
      db.users.find((u) => u.id === ada.id)!.emailPreferences = OPTED_OUT;
      const b = db.users.find((u) => u.id === bob.id)!;
      b.emailVerificationRequired = true;
    });
    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0), 0, "unsubscribed");
    assert.equal(await enrollInSequences({ kind: "member", userId: "usr_missing" }, { trigger: "signup" }, T0), 0);
    assert.equal(await enrollInSequences({ kind: "member", userId: bob.id }, { trigger: "signup" }, T0), 1, "may still confirm their address");

    const held = await processSequences(T0);
    assert.equal(held.sent, 0, "nothing goes to an unconfirmed address");
    assert.equal(held.nextAt, T0 + UNCONFIRMED_RETRY_MS);
    await mutate((db) => {
      db.users.find((u) => u.id === bob.id)!.emailVerifiedAt = iso(T0 + HOUR);
    });
    assert.equal((await processSequences(T0 + UNCONFIRMED_RETRY_MS)).sent, 1, "sent once the address is confirmed");
  });

  it("enrolls per course and per order", async () => {
    const onboarding = await sequence({ name: "Python onboarding", trigger: "enrollment", courseId: python.id, steps: [{ delayHours: 0, subject: "Welcome to {{ course_title }}", body: "Open {{ course_url }}" }] });
    const thanks = await sequence({ name: "Thank you", trigger: "purchase", steps: [{ delayHours: 0, subject: "Thanks for buying {{ course_title }}", body: "Enjoy." }] });

    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "enrollment", courseId: rust.id }, T0), 0, "another course");
    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "enrollment", courseId: python.id }, T0), 1);
    assert.equal((await enrollmentsOf(onboarding.id))[0]!.courseId, python.id);

    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "purchase", itemType: "course", itemId: python.id }, T0), 1);
    const first = await processSequences(T0);
    assert.equal(first.sent, 2);
    assert.equal(first.completed, 2);
    const subjects = (await getDb()).emails.map((e) => e.subject).sort();
    assert.deepEqual(subjects, ["Thanks for buying Python 101", "Welcome to Python 101"]);
    const onboardingMail = (await sequenceEmails(onboarding.id))[0]!;
    assert.ok(onboardingMail.text.includes("http://localhost:3000/courses/python-101"), "course link filled in");

    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "purchase", itemType: "course", itemId: python.id }, T0 + DAY), 0, "same order item");
    assert.equal(await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "purchase", itemType: "course", itemId: rust.id }, T0 + DAY), 1, "a second purchase starts it again");
    assert.equal((await processSequences(T0 + DAY)).sent, 1);
    assert.deepEqual((await sequenceEmails(thanks.id)).map((e) => e.subject).sort(), ["Thanks for buying Python 101", "Thanks for buying Rust basics"]);
  });
});

describe("the sequence runner", () => {
  quiet();
  beforeEach(async () => {
    await resetDb({ users: [admin, ada, bob], courses: [python] });
  });

  it("sends each step when it is due and completes after the last one", async () => {
    const s = await sequence();
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);

    const first = await processSequences(T0);
    assert.deepEqual([first.sent, first.completed, first.stopped], [1, 0, 0]);
    assert.equal(first.nextAt, T0 + 48 * HOUR);
    let [row] = await enrollmentsOf(s.id);
    assert.equal(row!.nextStepIndex, 1);
    assert.equal(row!.nextRunAt, iso(T0 + 48 * HOUR));
    assert.equal(row!.sentCount, 1);
    assert.equal(row!.lastSentAt, iso(T0));

    const early = await processSequences(T0 + 47 * HOUR);
    assert.equal(early.sent, 0, "the second email is not due yet");
    assert.equal(early.nextAt, T0 + 48 * HOUR);

    // The runner was down for a while: the late step goes out alone, and the next delay counts from it.
    const late = T0 + 48 * HOUR + 200 * HOUR;
    const second = await processSequences(late);
    assert.equal(second.sent, 1, "one step per run, even when two delays have passed");
    [row] = await enrollmentsOf(s.id);
    assert.equal(row!.nextStepIndex, 2);
    assert.equal(row!.nextRunAt, iso(late + 72 * HOUR));

    const third = await processSequences(late + 72 * HOUR);
    assert.deepEqual([third.sent, third.completed], [1, 1]);
    assert.equal(third.nextAt, null, "nothing left to wait for");
    [row] = await enrollmentsOf(s.id);
    assert.equal(row!.status, "completed");
    assert.equal(row!.endedAt, iso(late + 72 * HOUR));
    assert.equal(row!.sentCount, 3);
    assert.equal(row!.stopReason, undefined);

    const emails = await sequenceEmails(s.id);
    assert.deepEqual(emails.map((e) => e.subject).sort(), ["A good first step", "Still deciding?", "Welcome, Ada"]);
    assert.deepEqual((await getDb()).emailSequences.find((x) => x.id === s.id)!.steps.map((step) => step.sent), [1, 1, 1]);
    assert.equal((await processSequences(late + 400 * HOUR)).sent, 0);
  });

  it("personalizes and tracks each email and adds the recipient's unsubscribe link", async () => {
    const s = await sequence();
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await processSequences(T0);
    const [mail] = await sequenceEmails(s.id);
    assert.ok(mail);
    assert.equal(mail.to, "ada@example.com");
    assert.equal(mail.userId, ada.id);
    assert.equal(mail.category, "announcement");
    assert.equal(mail.trackingId, `sequence:${s.id}:${s.steps[0]!.id}`);
    assert.ok(mail.html.includes("Hi Ada,"));
    assert.ok(mail.html.includes(`/api/email/o/${mail.id}.`), "open pixel");
    assert.ok(mail.html.includes(`/api/email/c/${mail.id}?u=https%3A%2F%2Fexample.com%2Fstart`), "tracked link");
    assert.match(mail.html, /settings\/notifications\?unsubscribe=announcements&amp;u=usr_ada&amp;t=/);
  });

  it("never sends the same step twice, even when the bookkeeping of a run was lost", async () => {
    const s = await sequence();
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await processSequences(T0);
    await mutate((db) => {
      const row = db.sequenceEnrollments.find((e) => e.sequenceId === s.id)!;
      row.nextStepIndex = 0;
      row.nextRunAt = iso(T0);
      row.sentCount = 0;
    });
    await processSequences(T0 + 1_000);
    assert.equal((await sequenceEmails(s.id)).length, 1, "the email already in the outbox is not queued again");
    assert.equal((await enrollmentsOf(s.id))[0]!.nextStepIndex, 1, "the enrollment moves on");
  });

  it("stops people who unsubscribed, were disabled or deleted", async () => {
    const carl = makeUser({ id: "usr_carl", name: "Carl", email: "carl@example.com" });
    await resetDb({ users: [admin, ada, bob, carl] });
    const s = await sequence();
    for (const user of [ada, bob, carl]) await enrollInSequences({ kind: "member", userId: user.id }, { trigger: "signup" }, T0);
    assert.equal((await processSequences(T0)).sent, 3);

    await mutate((db) => {
      db.users.find((u) => u.id === ada.id)!.emailPreferences = OPTED_OUT;
      db.users.find((u) => u.id === bob.id)!.enabled = false;
      db.users = db.users.filter((u) => u.id !== carl.id);
    });
    const run = await processSequences(T0 + 48 * HOUR);
    assert.deepEqual([run.sent, run.stopped], [0, 3]);
    const reasons = Object.fromEntries((await enrollmentsOf(s.id)).map((e) => [e.email, e.stopReason]));
    assert.deepEqual(reasons, { "ada@example.com": "unsubscribed", "bob@example.com": "undeliverable", "carl@example.com": "undeliverable" });
    assert.equal((await sequenceEmails(s.id)).length, 3, "no further email");
  });

  it("sends nothing while the sequence or email is switched off, and catches up afterwards", async () => {
    const s = await sequence();
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await setSequenceActive(s.id, false);
    const paused = await processSequences(T0);
    assert.deepEqual([paused.sent, paused.nextAt], [0, null]);
    assert.equal(await enrollInSequences({ kind: "member", userId: bob.id }, { trigger: "signup" }, T0), 0, "nobody starts a paused sequence");

    await setSequenceActive(s.id, true);
    await mutate((db) => {
      db.settings.email.enabled = false;
    });
    const off = await processSequences(T0);
    assert.equal(off.emailDisabled, true);
    assert.equal(off.sent, 0);

    await mutate((db) => {
      db.settings.email.enabled = true;
    });
    assert.equal((await processSequences(T0 + HOUR)).sent, 1, "the waiting email goes out");
  });

  it("limits how much one run sends and asks to be run again", async () => {
    const crowd = Array.from({ length: 205 }, (_, i) => makeUser({ id: `usr_c${String(i).padStart(3, "0")}`, email: `c${i}@example.com`, name: `Member ${i}` }));
    await resetDb({ users: [admin, ...crowd] });
    const s = await sequence({ steps: [THREE_STEPS[0]] });
    for (const user of crowd) await enrollInSequences({ kind: "member", userId: user.id }, { trigger: "signup" }, T0);
    const first = await processSequences(T0);
    assert.equal(first.sent, 200);
    assert.equal(first.nextAt, T0, "more is due right away");
    const second = await processSequences(T0);
    assert.equal(second.sent, 5);
    assert.equal(new Set((await sequenceEmails(s.id)).map((e) => e.to)).size, 205);
  });
});

describe("sequence goals in practice", () => {
  quiet();

  it("stops a lead nurture the moment the person buys", async () => {
    await resetDb({ users: [admin], courses: [python], leads: [lead()] });
    const s = await sequence({ name: "Lead nurture", trigger: "lead", goal: "purchase" });

    const first = await processSequences(T0);
    assert.deepEqual([first.enrolled, first.sent], [1, 1], "the confirmed lead is picked up and gets the first email");
    const [row] = await enrollmentsOf(s.id);
    assert.equal(row!.leadId, "lead_1");
    assert.equal(row!.userId, undefined);
    assert.equal(row!.courseId, python.id);
    const [mail] = await sequenceEmails(s.id);
    assert.equal(mail!.subject, "Welcome, Lee");
    assert.equal(mail!.userId, undefined);
    assert.match(mail!.html, /\/free\/unsubscribe\?l=lead_1&amp;t=/);

    // The lead creates an account and pays for the course.
    const buyer = makeUser({ id: "usr_lee", name: "Lee Lead", email: "Lee@Example.org" });
    await mutate((db) => {
      db.users.push(buyer);
      db.payments.push(makePayment({ userId: buyer.id, itemId: python.id, status: "paid", paidAt: iso(T0 + HOUR), createdAt: iso(T0 + HOUR) }));
    });
    assert.equal(await stopReachedGoals(buyer.id, T0 + HOUR), 1);
    const [stopped] = await enrollmentsOf(s.id);
    assert.equal(stopped!.status, "stopped");
    assert.equal(stopped!.stopReason, "goal");
    assert.equal(stopped!.endedAt, iso(T0 + HOUR));
    assert.equal(await stopReachedGoals(buyer.id, T0 + 2 * HOUR), 0, "already stopped");

    assert.equal((await processSequences(T0 + 48 * HOUR)).sent, 0);
    assert.equal((await sequenceEmails(s.id)).length, 1, "no nurture email after the purchase");
  });

  it("also notices a reached goal when the step comes due (no event needed)", async () => {
    await resetDb({ users: [admin, ada], courses: [python] });
    const s = await sequence({ goal: "enrollment" });
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await processSequences(T0);
    await mutate((db) => {
      db.enrollments.push(makeEnrollment({ userId: ada.id, courseId: python.id, enrolledAt: iso(T0 + HOUR) }));
    });
    const run = await processSequences(T0 + 48 * HOUR);
    assert.deepEqual([run.sent, run.stopped], [0, 1]);
    assert.equal((await enrollmentsOf(s.id))[0]!.stopReason, "goal");
  });

  it("does not count what happened before the person started", async () => {
    await resetDb({
      users: [admin, ada],
      courses: [python],
      payments: [makePayment({ userId: ada.id, itemId: python.id, status: "paid", paidAt: iso(T0 - DAY), createdAt: iso(T0 - DAY) })],
    });
    await sequence({ goal: "purchase" });
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    assert.equal(await stopReachedGoals(ada.id, T0), 0);
    assert.equal((await processSequences(T0)).sent, 1);
  });

  it("respects a lead who unsubscribed, or whose new account opted out", async () => {
    await resetDb({ users: [admin], courses: [python], leads: [lead(), lead({ id: "lead_2", email: "max@example.org", name: "Max" })] });
    const s = await sequence({ name: "Lead nurture", trigger: "lead", goal: "none" });
    assert.equal((await processSequences(T0)).sent, 2);
    await mutate((db) => {
      db.leads.find((l) => l.id === "lead_1")!.unsubscribedAt = iso(T0 + HOUR);
      db.users.push(makeUser({ id: "usr_max", email: "max@example.org", emailPreferences: OPTED_OUT }));
    });
    const run = await processSequences(T0 + 48 * HOUR);
    assert.deepEqual([run.sent, run.stopped], [0, 2]);
    assert.ok((await enrollmentsOf(s.id)).every((e) => e.stopReason === "unsubscribed"));
  });
});

describe("triggers without an event", () => {
  quiet();

  it("enrolls leads once their double opt-in is confirmed, after the sequence was switched on", async () => {
    await resetDb({
      users: [admin, makeUser({ id: "usr_member", email: "member@example.org" })],
      courses: [python, rust],
      leads: [
        lead({ id: "lead_new", email: "new@example.org" }),
        lead({ id: "lead_old", email: "old@example.org", confirmedAt: iso(T0 - 10 * DAY) }),
        lead({ id: "lead_pending", email: "pending@example.org", confirmedAt: undefined }),
        lead({ id: "lead_rust", email: "rust@example.org", courseId: rust.id }),
        lead({ id: "lead_footer", email: "footer@example.org", courseId: undefined }),
        lead({ id: "lead_member", email: "member@example.org" }),
        lead({ id: "lead_gone", email: "gone@example.org", unsubscribedAt: iso(T0) }),
      ],
    });
    const forPython = await sequence({ name: "Python leads", trigger: "lead", courseId: python.id, goal: "none" });
    const anyLead = await sequence({ name: "All leads", trigger: "lead", goal: "none", steps: [{ delayHours: 24, subject: "Hello", body: "Hi" }] });

    const run = await processSequences(T0);
    assert.equal(run.enrolled, 4);
    assert.deepEqual((await enrollmentsOf(forPython.id)).map((e) => e.leadId), ["lead_new"], "only confirmed leads for that course, without an account");
    assert.deepEqual((await enrollmentsOf(anyLead.id)).map((e) => e.leadId).sort(), ["lead_footer", "lead_new", "lead_rust"]);
    assert.equal(run.sent, 1, "the delayed sequence sends later");
    assert.ok(run.nextAt !== null && run.nextAt <= T0 + SWEEP_INTERVAL_MS, "looks for new leads again soon");

    // The pending lead confirms later and is picked up by the next run.
    await mutate((db) => {
      db.leads.find((l) => l.id === "lead_pending")!.confirmedAt = iso(T0 + HOUR);
    });
    const next = await processSequences(T0 + HOUR);
    assert.equal(next.enrolled, 2);
    assert.equal((await processSequences(T0 + 2 * HOUR)).enrolled, 0, "nobody is enrolled twice");
  });

  it("enrolls members when they cross the inactivity threshold, and stops when they come back", async () => {
    const quietMember = makeUser({ id: "usr_quiet", name: "Quinn Quiet", email: "quinn@example.com", createdAt: iso(T0 - 200 * DAY), lastActiveAt: iso(T0 - 29 * DAY - 12 * HOUR) });
    const dormant = makeUser({ id: "usr_dormant", email: "dormant@example.com", createdAt: iso(T0 - 400 * DAY), lastActiveAt: iso(T0 - 300 * DAY) });
    const busy = makeUser({ id: "usr_busy", email: "busy@example.com", createdAt: iso(T0 - 200 * DAY), lastActiveAt: iso(T0 - DAY) });
    const staff = makeUser({ id: "usr_mod", email: "mod@example.com", roles: ["moderator"], createdAt: iso(T0 - 200 * DAY), lastActiveAt: iso(T0 - 29 * DAY - 12 * HOUR) });
    await resetDb({ users: [quietMember, dormant, busy, staff] });
    const s = await sequence({ name: "Win-back", trigger: "inactive", inactiveDays: 30, goal: "return", steps: [{ delayHours: 0, subject: "We saved your place, {{ first_name }}", body: "Come back." }, { delayHours: 168, subject: "New here", body: "Look." }] });

    assert.equal((await processSequences(T0)).enrolled, 0, "29.5 days is not 30");
    const run = await processSequences(T0 + DAY);
    assert.deepEqual([run.enrolled, run.sent], [1, 1], "only the member who just crossed the threshold: not the long-dormant one, not staff");
    const [row] = await enrollmentsOf(s.id);
    assert.equal(row!.userId, quietMember.id);
    assert.equal((await sequenceEmails(s.id))[0]!.subject, "We saved your place, Quinn");
    assert.equal((await processSequences(T0 + 2 * DAY)).enrolled, 0, "the same quiet period never enrolls twice");

    await mutate((db) => {
      db.users.find((u) => u.id === quietMember.id)!.lastActiveAt = iso(T0 + 3 * DAY);
    });
    const back = await processSequences(T0 + 8 * DAY);
    assert.deepEqual([back.sent, back.stopped], [0, 1]);
    assert.equal((await enrollmentsOf(s.id))[0]!.stopReason, "goal");
  });
});

describe("sequences and domain events", () => {
  quiet();
  beforeEach(async () => {
    await resetDb({ users: [admin, ada], courses: [python], leads: [lead({ email: "ada@example.com", id: "lead_ada" })] });
  });

  it("starts the matching sequences when the event happens", async () => {
    const welcome = await sequence();
    const onboarding = await sequence({ name: "Onboarding", trigger: "enrollment", courseId: python.id });
    const thanks = await sequence({ name: "Thanks", trigger: "purchase" });

    emit("user.registered", { userId: ada.id, email: ada.email, name: ada.name, source: "signup" });
    emit("enrollment.created", { enrollmentId: "enr_1", userId: ada.id, courseId: python.id, memberType: "student" });
    emit("payment.paid", { paymentId: "pay_1", orderId: "ORD-1", userId: ada.id, itemType: "course", itemId: python.id, itemTitle: "Python 101", amount: 1000, taxAmount: 0, discountAmount: 0, currency: "USD", gateway: "stripe" });
    await settleEvents();

    for (const s of [welcome, onboarding, thanks]) assert.equal((await enrollmentsOf(s.id)).length, 1, s.name);
  });

  it("leaves imported accounts and staff enrollments alone", async () => {
    const welcome = await sequence();
    const onboarding = await sequence({ name: "Onboarding", trigger: "enrollment" });
    emit("user.registered", { userId: ada.id, email: ada.email, name: ada.name, source: "import" });
    emit("enrollment.created", { enrollmentId: "enr_1", userId: ada.id, courseId: python.id, memberType: "staff" });
    await settleEvents();
    assert.equal((await enrollmentsOf(welcome.id)).length, 0);
    assert.equal((await enrollmentsOf(onboarding.id)).length, 0);
  });

  it("ends sequences whose goal the event fulfils", async () => {
    // A nurture for the lead's address ("creates an account" goal) and a welcome series ("enrolls" goal).
    const nurture = await sequence({ name: "Nurture", trigger: "lead", goal: "signup" });
    const welcome = await sequence({ goal: "enrollment" });
    await mutate((db) => {
      db.sequenceEnrollments.push({ id: "sqe_lead", sequenceId: nurture.id, leadId: "lead_ada", email: "ada@example.com", nextStepIndex: 1, nextRunAt: iso(T0 + DAY), status: "active", createdAt: iso(T0 - DAY), contextKey: "" });
    });

    emit("user.registered", { userId: ada.id, email: ada.email, name: ada.name, source: "signup" });
    await settleEvents();
    assert.equal((await enrollmentsOf(nurture.id))[0]!.stopReason, "goal", "the lead signed up");
    assert.equal((await enrollmentsOf(welcome.id))[0]!.status, "active");

    await mutate((db) => {
      db.enrollments.push(makeEnrollment({ userId: ada.id, courseId: python.id, enrolledAt: iso(Date.now() + 1_000) }));
    });
    emit("enrollment.created", { enrollmentId: "enr_1", userId: ada.id, courseId: python.id, memberType: "student" });
    await settleEvents();
    assert.equal((await enrollmentsOf(welcome.id))[0]!.stopReason, "goal", "the new member enrolled");
  });
});

describe("sequence reports", () => {
  quiet();
  beforeEach(async () => {
    await resetDb({ users: [admin, ada, bob], courses: [python] });
  });

  it("reports per-email statistics, link clicks and unsubscribes", async () => {
    const s = await sequence();
    for (const user of [ada, bob]) await enrollInSequences({ kind: "member", userId: user.id }, { trigger: "signup" }, T0);
    await processSequences(T0);
    const emails = await sequenceEmails(s.id);
    const adaMail = emails.find((e) => e.to === "ada@example.com")!;
    await recordEmailHit(adaMail.id, { type: "click", url: "https://example.com/start" });
    await mutate((db) => {
      db.users.find((u) => u.id === bob.id)!.emailPreferences = OPTED_OUT;
    });
    assert.ok((await refreshCampaignStats()) >= 1);

    const report = await getSequenceReport(s.id);
    assert.ok(report);
    assert.equal(report.triggerLabel, "When someone creates an account");
    assert.equal(report.sent, 2);
    assert.equal(report.sequence.unsubscribes, 1);
    assert.deepEqual(report.summary, { total: 2, active: 2, completed: 0, stopped: 0, goal: 0, unsubscribed: 0, undeliverable: 0, manual: 0, goalRate: 0 });
    assert.deepEqual(report.steps.map((row) => [row.offsetHours, row.sent, row.uniqueOpens, row.uniqueClicks, row.waiting]), [
      [0, 2, 1, 1, 0],
      [48, 0, 0, 0, 2],
      [120, 0, 0, 0, 0],
    ]);
    assert.deepEqual(report.events.links.map((l) => l.url), ["https://example.com/start"]);
    assert.equal(await getSequenceReport("seq_missing"), null);

    // The numbers survive the outbox clean-up.
    await mutate((db) => {
      db.emails = [];
    });
    await refreshCampaignStats();
    const later = await getSequenceReport(s.id);
    assert.equal(later!.sequence.unsubscribes, 1);
    assert.equal(later!.steps[0]!.uniqueClicks, 1);
  });

  it("lists sequences with their numbers, searchable and by status", async () => {
    const welcome = await sequence({ description: "Greets new members" });
    await sequence({ name: "Win-back", trigger: "inactive", inactiveDays: 30 }, { active: false });
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    await processSequences(T0);

    const all = await listSequences({ status: "all", q: "" });
    assert.deepEqual(all.counts, { all: 2, active: 1, paused: 1 });
    assert.equal(all.rows[0]!.sequence.id, welcome.id, "switched-on sequences first");
    assert.equal(all.rows[0]!.sent, 1);
    assert.equal(all.rows[0]!.summary.active, 1);
    assert.equal(all.rows[1]!.triggerLabel, "After 30 days without activity");
    assert.deepEqual((await listSequences({ status: "paused", q: "" })).rows.map((r) => r.sequence.name), ["Win-back"]);
    assert.deepEqual((await listSequences({ status: "all", q: "greets" })).rows.map((r) => r.sequence.name), ["Welcome series"]);
    assert.equal((await listSequences({ status: "all", q: "nothing like this" })).total, 0);
  });

  it("lists, searches and stops the people in a sequence", async () => {
    const s = await sequence();
    for (const user of [ada, bob]) await enrollInSequences({ kind: "member", userId: user.id }, { trigger: "signup" }, T0);
    const everyone = await listSequenceEnrollments(s.id, { status: "all", q: "", page: 1 });
    assert.deepEqual([everyone.total, everyone.page, everyone.pageCount], [2, 1, 1]);
    assert.deepEqual((await listSequenceEnrollments(s.id, { status: "all", q: "LOVELACE", page: 1 })).rows.map((e) => e.email), ["ada@example.com"]);
    assert.deepEqual((await listSequenceEnrollments(s.id, { status: "all", q: "bob@", page: 7 })).rows.map((e) => e.email), ["bob@example.com"]);

    const adaRow = everyone.rows.find((e) => e.userId === ada.id)!;
    const stopped = await stopEnrollment(adaRow.id);
    assert.deepEqual(stopped, { ok: true, sequenceId: s.id });
    assert.equal((await stopEnrollment(adaRow.id)).ok, false, "already stopped");
    assert.equal((await stopEnrollment("sqe_missing")).ok, false);
    assert.deepEqual((await listSequenceEnrollments(s.id, { status: "stopped", q: "", page: 1 })).rows.map((e) => [e.email, e.stopReason]), [["ada@example.com", "manual"]]);

    assert.equal((await processSequences(T0)).sent, 1, "only the person still in the sequence gets the email");
    assert.equal(await stopActiveEnrollments(s.id), 1);
    assert.equal(await stopActiveEnrollments(s.id), 0);
    assert.equal((await listSequenceEnrollments(s.id, { status: "active", q: "", page: 1 })).total, 0);
    assert.equal((await listSequenceEnrollments(s.id, { status: "all", q: "", page: 1 }, { all: true })).rows.length, 2);
  });

  it("runs as part of the comms run", async () => {
    const s = await sequence();
    await enrollInSequences({ kind: "member", userId: ada.id }, { trigger: "signup" }, T0);
    const run = await runComms({ wait: true, now: T0 });
    assert.equal(run.ran, true);
    assert.equal(run.error, undefined);
    assert.equal(run.sequences.sent, 1);
    assert.equal(run.nextRunAt, iso(T0 + 48 * HOUR));
    assert.equal((await sequenceEmails(s.id)).length, 1);
  });
});
