/**
 * Automated email sequences: the pure rules.
 *
 * A sequence is a series of steps (delay, subject, body) that starts for a
 * person when its trigger happens — a new account, a confirmed lead, a course
 * enrollment, a paid order or a period of inactivity. Each person gets a
 * `SequenceEnrollment` that remembers the next step and when it is due. The
 * runner sends due steps and ends an enrollment when
 *
 *  - the last step was sent ("completed"),
 *  - the sequence's goal happened, e.g. a lead nurture stops once the person
 *    buys ("stopped", reason "goal"),
 *  - the person unsubscribed or can no longer be emailed,
 *  - or staff stopped it by hand.
 *
 * Delays count from the moment the previous step was actually sent (the
 * first one from the trigger), so a runner that was down for a while never
 * sends several steps at once.
 *
 * Pure module: the form, the runner and the tests share it.
 */
import type { EmailSequence, EmailSequenceStep, Enrollment, Payment, SequenceEnrollment, SequenceTrigger } from "@/lib/types";
import { uid } from "@/lib/utils";
import { checkContent } from "./campaign-core";
import type { DeliveryBlock } from "./segments";
import { ratePercent } from "./tracking-core";

export type SequenceGoal = "none" | "purchase" | "enrollment" | "completion" | "signup" | "return";
export type SequenceStopReason = "goal" | "unsubscribed" | "undeliverable" | "manual";

declare module "@/lib/types" {
  interface EmailSequenceStep {
    /** Round 3 comms: emails of this step handed to the outbox. */
    sent?: number;
  }
  interface EmailSequence {
    /** Internal note shown to staff. */
    description?: string;
    /** What ends the sequence early for a person (see `goalReached`). */
    goal?: SequenceGoal;
    /** When the sequence was last switched on; only triggers after this moment enroll people. */
    activatedAt?: string;
    updatedAt?: string;
    createdById?: string;
    /** Recipients who unsubscribed after an email of this sequence. */
    unsubscribes?: number;
  }
  interface SequenceEnrollment {
    /** Recipient name at enrollment (for `{{ first_name }}` when the person is a lead). */
    name?: string;
    /** Course that enrolled the person (fills `{{ course_title }}` / `{{ course_url }}`). */
    courseId?: string;
    /** What this enrollment was for ("" for one-off triggers): the same trigger never enrolls a person twice. */
    contextKey?: string;
    stopReason?: SequenceStopReason;
    /** When the enrollment was completed or stopped. */
    endedAt?: string;
    lastSentAt?: string;
    sentCount?: number;
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const SEQUENCE_LIMITS = {
  name: 120,
  description: 500,
  steps: 20,
  /** One year. */
  maxDelayHours: 8_760,
  maxInactiveDays: 3_650,
} as const;

/* ------------------------------------------------------------------ */
/* Triggers and goals                                                  */
/* ------------------------------------------------------------------ */

export const TRIGGER_OPTIONS: readonly { value: SequenceTrigger; label: string; description: string; course: boolean }[] = [
  { value: "signup", label: "New account", description: "Starts when someone creates an account.", course: false },
  { value: "lead", label: "New lead", description: "Starts when someone confirms their address on a lead form.", course: true },
  { value: "enrollment", label: "Course enrollment", description: "Starts when a learner enrolls in a course.", course: true },
  { value: "purchase", label: "Purchase", description: "Starts when an order is paid.", course: true },
  { value: "inactive", label: "Inactivity", description: "Starts when a member hasn't been active for a number of days.", course: false },
];

const TRIGGERS = new Set<string>(TRIGGER_OPTIONS.map((t) => t.value));

export function isSequenceTrigger(value: unknown): value is SequenceTrigger {
  return typeof value === "string" && TRIGGERS.has(value);
}

export const GOAL_LABELS: Record<SequenceGoal, { label: string; description: string }> = {
  none: { label: "No goal", description: "Everyone receives every step unless they unsubscribe." },
  purchase: { label: "Makes a purchase", description: "Stops as soon as the person pays for an order." },
  enrollment: { label: "Enrolls in a course", description: "Stops as soon as the person enrolls in any course." },
  completion: { label: "Completes the course", description: "Stops once the learner finishes the course." },
  signup: { label: "Creates an account", description: "Stops once the lead signs up." },
  return: { label: "Comes back", description: "Stops as soon as the member is active again." },
};

/** Goals that make sense for each trigger; the first one is the default. */
export const TRIGGER_GOALS: Record<SequenceTrigger, readonly SequenceGoal[]> = {
  signup: ["none", "enrollment", "purchase"],
  lead: ["purchase", "signup", "none"],
  enrollment: ["none", "completion", "purchase"],
  purchase: ["none", "completion"],
  inactive: ["return", "none"],
};

export function defaultGoal(trigger: SequenceTrigger): SequenceGoal {
  return TRIGGER_GOALS[trigger][0]!;
}

export function sequenceGoal(sequence: Pick<EmailSequence, "trigger" | "goal">): SequenceGoal {
  return sequence.goal && TRIGGER_GOALS[sequence.trigger].includes(sequence.goal) ? sequence.goal : "none";
}

/** "When a learner enrolls in Python 101", "After 30 days without activity", … */
export function describeTrigger(sequence: Pick<EmailSequence, "trigger" | "courseId" | "inactiveDays">, courseTitle: (courseId: string) => string | undefined): string {
  const course = sequence.courseId ? (courseTitle(sequence.courseId) ?? "a deleted course") : null;
  switch (sequence.trigger) {
    case "signup":
      return "When someone creates an account";
    case "lead":
      return course ? `When a lead interested in ${course} confirms their address` : "When a lead confirms their address";
    case "enrollment":
      return course ? `When a learner enrolls in ${course}` : "When a learner enrolls in any course";
    case "purchase":
      return course ? `When an order for ${course} is paid` : "When any order is paid";
    case "inactive": {
      const days = sequence.inactiveDays ?? 30;
      return `After ${days} ${days === 1 ? "day" : "days"} without activity`;
    }
  }
}

/** What happened, as far as sequences care. */
export type TriggerEvent =
  | { trigger: "signup" }
  | { trigger: "lead"; courseId?: string }
  | { trigger: "enrollment"; courseId: string }
  | { trigger: "purchase"; itemType: string; itemId: string }
  | { trigger: "inactive"; lastActivityAt: number };

/** Whether an active sequence starts for this event. */
export function matchesTrigger(sequence: Pick<EmailSequence, "trigger" | "courseId" | "active" | "steps">, event: TriggerEvent): boolean {
  if (!sequence.active || sequence.trigger !== event.trigger || sequence.steps.length === 0) return false;
  if (!sequence.courseId) return true;
  switch (event.trigger) {
    case "lead":
      return event.courseId === sequence.courseId;
    case "enrollment":
      return event.courseId === sequence.courseId;
    case "purchase":
      return event.itemType === "course" && event.itemId === sequence.courseId;
    default:
      return true;
  }
}

/** The key that makes a trigger unique for a person, and the course it is about. */
export function triggerContext(event: TriggerEvent): { contextKey: string; courseId?: string } {
  switch (event.trigger) {
    case "enrollment":
      return { contextKey: `course:${event.courseId}`, courseId: event.courseId };
    case "purchase":
      return { contextKey: `${event.itemType}:${event.itemId}`, courseId: event.itemType === "course" ? event.itemId : undefined };
    case "lead":
      return { contextKey: "", courseId: event.courseId };
    case "inactive":
      return { contextKey: `inactive:${event.lastActivityAt}` };
    case "signup":
      return { contextKey: "" };
  }
}

/**
 * A person can start a sequence when they aren't in it right now and the
 * same trigger (same course, same order, same period of inactivity) hasn't
 * enrolled them before.
 */
export function canEnroll(existing: readonly Pick<SequenceEnrollment, "status" | "contextKey">[], contextKey: string): boolean {
  return !existing.some((e) => e.status === "active" || (e.contextKey ?? "") === contextKey);
}

/**
 * The inactivity trigger fires when the threshold is crossed while the
 * sequence is on. Members who were already inactive for longer when it was
 * switched on are left alone, so activating a win-back sequence never mails
 * the whole dormant list at once.
 */
export function inactivityDue(lastActivityAt: number, inactiveDays: number, activatedAt: number, now: number): boolean {
  const crossing = lastActivityAt + inactiveDays * DAY_MS;
  return crossing <= now && crossing >= activatedAt;
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export interface GoalFacts {
  /** When the person started the sequence (ms). */
  since: number;
  /** Course the enrollment is about, if any. */
  courseId?: string;
  /** The address belongs to an account. */
  hasAccount: boolean;
  payments: readonly Pick<Payment, "status" | "paidAt" | "createdAt">[];
  enrollments: readonly Pick<Enrollment, "courseId" | "memberType" | "enrolledAt" | "completedAt">[];
  /** Latest sign of life of the account (ms). */
  lastActivityAt?: number;
}

function at(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Whether the goal has happened since the person started the sequence. */
export function goalReached(goal: SequenceGoal, facts: GoalFacts): boolean {
  switch (goal) {
    case "none":
      return false;
    case "purchase":
      return facts.payments.some((p) => p.status === "paid" && at(p.paidAt ?? p.createdAt) >= facts.since);
    case "enrollment":
      return facts.enrollments.some((e) => e.memberType !== "staff" && at(e.enrolledAt) >= facts.since);
    case "completion":
      return facts.enrollments.some((e) => !!e.completedAt && (facts.courseId ? e.courseId === facts.courseId : at(e.completedAt) >= facts.since));
    case "signup":
      return facts.hasAccount;
    case "return":
      return (facts.lastActivityAt ?? 0) > facts.since;
  }
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

function delayMs(step: Pick<EmailSequenceStep, "delayHours"> | undefined): number {
  const hours = step ? Number(step.delayHours) : 0;
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, SEQUENCE_LIMITS.maxDelayHours) * HOUR_MS : 0;
}

/** When the first step is due for someone who triggered the sequence at `startedAt`. */
export function firstRunAt(steps: readonly Pick<EmailSequenceStep, "delayHours">[], startedAt: number): number {
  return startedAt + delayMs(steps[0]);
}

/** When the step after `sentIndex` is due, given that step `sentIndex` went out at `sentAt`; null when it was the last. */
export function nextRunAfter(steps: readonly Pick<EmailSequenceStep, "delayHours">[], sentIndex: number, sentAt: number): number | null {
  const next = steps[sentIndex + 1];
  return next ? sentAt + delayMs(next) : null;
}

/** Hours from the trigger to each step when every step goes out on time. */
export function cumulativeDelayHours(steps: readonly Pick<EmailSequenceStep, "delayHours">[]): number[] {
  let total = 0;
  return steps.map((step) => (total += delayMs(step) / HOUR_MS));
}

export type DelayUnit = "hours" | "days";

/** 72 → { value: 3, unit: "days" }; 36 → { value: 36, unit: "hours" }. */
export function splitDelay(hours: number): { value: number; unit: DelayUnit } {
  const h = Math.max(0, Math.round(Number(hours) || 0));
  return h > 0 && h % 24 === 0 ? { value: h / 24, unit: "days" } : { value: h, unit: "hours" };
}

export function joinDelay(value: number, unit: DelayUnit): number {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return Math.min(unit === "days" ? n * 24 : n, SEQUENCE_LIMITS.maxDelayHours);
}

/** "immediately", "2 hours", "36 hours", "3 days", "2 days 6 hours". */
export function formatDelay(hours: number): string {
  const h = Math.max(0, Math.round(Number(hours) || 0));
  if (h === 0) return "immediately";
  const days = Math.floor(h / 24);
  const rest = h % 24;
  const parts: string[] = [];
  if (days && h >= 48) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  else if (days && rest === 0) parts.push("1 day");
  if (h < 48 && rest !== 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  else if (rest) parts.push(`${rest} ${rest === 1 ? "hour" : "hours"}`);
  return parts.join(" ");
}

/** How long an address may stay unconfirmed before the enrollment is given up. */
export const UNCONFIRMED_GRACE_MS = 14 * DAY_MS;
/** How often an enrollment waiting for a confirmed address is looked at again. */
export const UNCONFIRMED_RETRY_MS = HOUR_MS;

export type StepDecision =
  | { action: "send"; stepIndex: number }
  | { action: "complete" }
  | { action: "stop"; reason: SequenceStopReason }
  | { action: "wait"; until: number };

/**
 * What to do with an active enrollment right now.
 *
 * `block` is why the person can't be emailed at the moment (null when they
 * can, "missing" when the account or lead was deleted).
 */
export function decideStep(input: {
  steps: readonly Pick<EmailSequenceStep, "id">[];
  enrollment: Pick<SequenceEnrollment, "nextStepIndex" | "nextRunAt" | "createdAt">;
  block: DeliveryBlock | "missing" | null;
  goal: boolean;
  now: number;
}): StepDecision {
  const { steps, enrollment, block, goal, now } = input;
  if (block === "missing" || block === "disabled" || block === "invalid") return { action: "stop", reason: "undeliverable" };
  if (block === "unsubscribed") return { action: "stop", reason: "unsubscribed" };
  if (goal) return { action: "stop", reason: "goal" };
  if (enrollment.nextStepIndex >= steps.length) return { action: "complete" };
  const due = at(enrollment.nextRunAt);
  if (due > now) return { action: "wait", until: due };
  if (block === "unconfirmed") {
    // The address isn't verified yet: hold the step, and give up after two weeks.
    if (now - at(enrollment.createdAt) > UNCONFIRMED_GRACE_MS) return { action: "stop", reason: "undeliverable" };
    return { action: "wait", until: now + UNCONFIRMED_RETRY_MS };
  }
  return { action: "send", stepIndex: Math.max(0, enrollment.nextStepIndex) };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface SequenceDraft {
  name: string;
  description?: string;
  trigger: SequenceTrigger;
  courseId?: string;
  inactiveDays?: number;
  goal: SequenceGoal;
  steps: EmailSequenceStep[];
}

export type SequenceCheck = { ok: true; value: SequenceDraft } | { ok: false; error: string; fieldErrors: Record<string, string> };

const STEP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max + 1) : "";
}

/**
 * Validate a sequence submitted by the form. Step ids are kept when valid
 * (they identify the step in tracking), new steps get one. Step field errors
 * are keyed `steps.<index>.subject|body|delayHours`.
 */
export function checkSequence(raw: Record<string, unknown>, knownCourseIds: ReadonlySet<string>): SequenceCheck {
  const fieldErrors: Record<string, string> = {};
  const name = text(raw.name, SEQUENCE_LIMITS.name);
  if (!name) fieldErrors.name = "Give the sequence a name.";
  else if (name.length > SEQUENCE_LIMITS.name) fieldErrors.name = `Keep the name under ${SEQUENCE_LIMITS.name} characters.`;
  const description = text(raw.description, SEQUENCE_LIMITS.description);
  if (description.length > SEQUENCE_LIMITS.description) fieldErrors.description = `Keep the note under ${SEQUENCE_LIMITS.description} characters.`;

  const trigger = isSequenceTrigger(raw.trigger) ? raw.trigger : null;
  if (!trigger) fieldErrors.trigger = "Choose what starts the sequence.";

  let courseId: string | undefined;
  if (trigger && TRIGGER_OPTIONS.find((t) => t.value === trigger)?.course && typeof raw.courseId === "string" && raw.courseId) {
    if (knownCourseIds.has(raw.courseId)) courseId = raw.courseId;
    else fieldErrors.courseId = "This course no longer exists. Choose another one.";
  }

  let inactiveDays: number | undefined;
  if (trigger === "inactive") {
    const days = Math.floor(Number(raw.inactiveDays));
    if (!Number.isFinite(days) || days < 1) fieldErrors.inactiveDays = "Enter the number of days without activity.";
    else if (days > SEQUENCE_LIMITS.maxInactiveDays) fieldErrors.inactiveDays = `Use at most ${SEQUENCE_LIMITS.maxInactiveDays} days.`;
    else inactiveDays = days;
  }

  const goal: SequenceGoal = trigger && typeof raw.goal === "string" && (TRIGGER_GOALS[trigger] as readonly string[]).includes(raw.goal) ? (raw.goal as SequenceGoal) : trigger ? defaultGoal(trigger) : "none";

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: EmailSequenceStep[] = [];
  const usedIds = new Set<string>();
  if (rawSteps.length === 0) fieldErrors.steps = "Add at least one email.";
  else if (rawSteps.length > SEQUENCE_LIMITS.steps) fieldErrors.steps = `A sequence can have at most ${SEQUENCE_LIMITS.steps} emails.`;
  else {
    rawSteps.forEach((item, index) => {
      const step = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const content = checkContent({ subject: step.subject, body: step.body }, "sequence", `steps.${index}.`);
      Object.assign(fieldErrors, content.errors);
      const hours = Number(step.delayHours);
      let delayHours = 0;
      if (!Number.isFinite(hours) || hours < 0) fieldErrors[`steps.${index}.delayHours`] = "Enter a delay of zero or more.";
      else if (hours > SEQUENCE_LIMITS.maxDelayHours) fieldErrors[`steps.${index}.delayHours`] = "Use a delay of at most one year.";
      else delayHours = Math.round(hours);
      let id = typeof step.id === "string" && STEP_ID_RE.test(step.id) && !usedIds.has(step.id) ? step.id : uid("step");
      while (usedIds.has(id)) id = uid("step");
      usedIds.add(id);
      steps.push({ id, delayHours, subject: content.value.subject, body: content.value.body });
    });
  }

  if (Object.keys(fieldErrors).length || !trigger) {
    const stepError = Object.keys(fieldErrors).find((k) => k.startsWith("steps."));
    const error = stepError ? `Check email ${Number(stepError.split(".")[1]) + 1}: ${fieldErrors[stepError]}` : "Check the highlighted fields.";
    return { ok: false, error, fieldErrors };
  }
  const value: SequenceDraft = { name, trigger, goal, steps };
  if (description) value.description = description;
  if (courseId) value.courseId = courseId;
  if (inactiveDays) value.inactiveDays = inactiveDays;
  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export interface EnrollmentSummary {
  total: number;
  active: number;
  completed: number;
  stopped: number;
  /** Stopped because the goal happened. */
  goal: number;
  unsubscribed: number;
  undeliverable: number;
  manual: number;
  /** Share of everyone who started that reached the goal, in percent. */
  goalRate: number;
}

export function summarizeEnrollments(list: readonly Pick<SequenceEnrollment, "status" | "stopReason">[]): EnrollmentSummary {
  const s: EnrollmentSummary = { total: list.length, active: 0, completed: 0, stopped: 0, goal: 0, unsubscribed: 0, undeliverable: 0, manual: 0, goalRate: 0 };
  for (const e of list) {
    if (e.status === "active") s.active++;
    else if (e.status === "completed") s.completed++;
    else {
      s.stopped++;
      if (e.stopReason === "goal") s.goal++;
      else if (e.stopReason === "unsubscribed") s.unsubscribed++;
      else if (e.stopReason === "undeliverable") s.undeliverable++;
      else s.manual++;
    }
  }
  s.goalRate = ratePercent(s.goal, s.total);
  return s;
}

export const STOP_REASON_LABELS: Record<SequenceStopReason, string> = {
  goal: "Goal reached",
  unsubscribed: "Unsubscribed",
  undeliverable: "Can't be emailed",
  manual: "Stopped by staff",
};

/** "Active", "Completed", "Goal reached", … */
export function enrollmentStateLabel(e: Pick<SequenceEnrollment, "status" | "stopReason">): string {
  if (e.status === "active") return "Active";
  if (e.status === "completed") return "Completed";
  return STOP_REASON_LABELS[e.stopReason ?? "manual"];
}

export const ENROLLMENT_STATUS_FILTERS = ["all", "active", "completed", "stopped"] as const;
export type EnrollmentStatusFilter = (typeof ENROLLMENT_STATUS_FILTERS)[number];

export interface EnrollmentFilters {
  status: EnrollmentStatusFilter;
  q: string;
  page: number;
}

export const ENROLLMENTS_PAGE_SIZE = 25;

export function parseEnrollmentFilters(params: Record<string, string | string[] | undefined>): EnrollmentFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = first(params.status);
  const page = Math.floor(Number(first(params.page)));
  return {
    status: (ENROLLMENT_STATUS_FILTERS as readonly string[]).includes(status) ? (status as EnrollmentStatusFilter) : "all",
    q: first(params.q).trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export const ENROLLMENT_CSV_HEADER = ["Email", "Name", "Type", "State", "Emails sent", "Next email", "Next email due (UTC)", "Started (UTC)", "Last email (UTC)", "Ended (UTC)"];

export function enrollmentCsvRows(list: readonly SequenceEnrollment[], steps: readonly Pick<EmailSequenceStep, "subject">[]): string[][] {
  return [
    ENROLLMENT_CSV_HEADER,
    ...list.map((e) => [
      e.email,
      e.name ?? "",
      e.leadId ? "Lead" : "Member",
      enrollmentStateLabel(e),
      String(e.sentCount ?? 0),
      e.status === "active" ? (steps[e.nextStepIndex]?.subject ?? "") : "",
      e.status === "active" ? e.nextRunAt : "",
      e.createdAt,
      e.lastSentAt ?? "",
      e.endedAt ?? "",
    ]),
  ];
}

/* ------------------------------------------------------------------ */
/* Starter templates                                                   */
/* ------------------------------------------------------------------ */

export interface SequenceTemplate {
  key: string;
  title: string;
  summary: string;
  draft: Omit<SequenceDraft, "steps"> & { steps: Omit<EmailSequenceStep, "id">[] };
}

export const SEQUENCE_TEMPLATES: readonly SequenceTemplate[] = [
  {
    key: "welcome",
    title: "Welcome series",
    summary: "Three emails that greet new members and point them to their first course.",
    draft: {
      name: "Welcome series",
      trigger: "signup",
      goal: "enrollment",
      steps: [
        {
          delayHours: 0,
          subject: "Welcome to {{ site_name }}, {{ first_name }}",
          body: "Hi {{ first_name }},\n\nThanks for joining {{ site_name }}. Your account is ready, and the quickest way to get going is to pick a course and open its first lesson.\n\n[Browse the courses]({{ site_url }}/courses)\n\nIf you have a question at any point, reply to this email and we'll help.",
        },
        {
          delayHours: 48,
          subject: "A good first step",
          body: "Hi {{ first_name }},\n\nLearners who finish one lesson in their first week are far more likely to complete a course. Ten minutes is enough to start.\n\n[Find a course to begin with]({{ site_url }}/courses)",
        },
        {
          delayHours: 120,
          subject: "Still deciding what to learn?",
          body: "Hi {{ first_name }},\n\nTell us what you'd like to get better at by replying to this email, and we'll point you to the right course.\n\nYou can also see what other learners are taking: {{ site_url }}/courses",
        },
      ],
    },
  },
  {
    key: "lead-nurture",
    title: "Lead nurture",
    summary: "Follows up with new leads and stops the moment they buy.",
    draft: {
      name: "Lead nurture",
      trigger: "lead",
      goal: "purchase",
      steps: [
        {
          delayHours: 0,
          subject: "Here's what you asked for",
          body: "Hi {{ first_name }},\n\nThanks for your interest in {{ course_title }}. You can look through the full outline here:\n\n{{ course_url }}\n\nOver the next few days we'll send you a couple of short notes about what the course covers and who it's for.",
        },
        {
          delayHours: 72,
          subject: "What you'll be able to do after {{ course_title }}",
          body: "Hi {{ first_name }},\n\nA course is only worth your time if it changes what you can do. Have a look at the outcomes and the lesson list of {{ course_title }} and see whether they match where you want to be:\n\n{{ course_url }}",
        },
        {
          delayHours: 96,
          subject: "Any questions before you start?",
          body: "Hi {{ first_name }},\n\nIf something is holding you back from starting {{ course_title }}, reply to this email and tell us. We read every message.\n\nWhen you're ready: {{ course_url }}",
        },
      ],
    },
  },
  {
    key: "onboarding",
    title: "Course onboarding",
    summary: "Keeps new learners moving through the course they enrolled in until they finish it.",
    draft: {
      name: "Course onboarding",
      trigger: "enrollment",
      goal: "completion",
      steps: [
        {
          delayHours: 24,
          subject: "Your next lesson in {{ course_title }}",
          body: "Hi {{ first_name }},\n\nWelcome to {{ course_title }}. The next lesson is waiting where you left off:\n\n{{ course_url }}\n\nA little progress every day adds up quickly.",
        },
        {
          delayHours: 144,
          subject: "How is {{ course_title }} going?",
          body: "Hi {{ first_name }},\n\nYou've been enrolled in {{ course_title }} for a week. If you're stuck on something, post a question in the course discussions and your instructor will help.\n\n[Continue the course]({{ course_url }})",
        },
      ],
    },
  },
  {
    key: "win-back",
    title: "Win-back",
    summary: "Reaches out to members who have been away for a month and stops when they return.",
    draft: {
      name: "Win-back",
      trigger: "inactive",
      inactiveDays: 30,
      goal: "return",
      steps: [
        {
          delayHours: 0,
          subject: "We saved your place, {{ first_name }}",
          body: "Hi {{ first_name }},\n\nIt's been a while since you last visited {{ site_name }}. Your courses and progress are right where you left them.\n\n[Pick up where you left off]({{ site_url }}/dashboard)",
        },
        {
          delayHours: 168,
          subject: "New on {{ site_name }}",
          body: "Hi {{ first_name }},\n\nNew courses and lessons have been added since your last visit. Have a look at what's new:\n\n{{ site_url }}/courses",
        },
      ],
    },
  },
];

export function findSequenceTemplate(key: string | null | undefined): SequenceTemplate | null {
  return SEQUENCE_TEMPLATES.find((t) => t.key === key) ?? null;
}
