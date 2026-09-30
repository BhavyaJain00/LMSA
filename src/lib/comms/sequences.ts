import "server-only";
import type { Course, Database, EmailSequence, EmailSequenceStep, Enrollment, Lead, Payment, SequenceEnrollment, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { type EnqueueEmailInput, enqueueEmails } from "@/lib/email/outbox";
import { uid } from "@/lib/utils";
import { type PreparedCampaign, courseValues, prepareCampaign, renderCampaignEmail } from "./render";
import { type DeliveryBlock, type SegmentRecipient, lastActivityByUser, leadBlock, leadRecipient, memberBlock, memberRecipient } from "./segments";
import {
  ENROLLMENTS_PAGE_SIZE,
  type EnrollmentFilters,
  type EnrollmentSummary,
  type GoalFacts,
  type SequenceDraft,
  type SequenceStopReason,
  type StepDecision,
  type TriggerEvent,
  canEnroll,
  checkSequence,
  cumulativeDelayHours,
  decideStep,
  describeTrigger,
  firstRunAt,
  goalReached,
  inactivityDue,
  matchesTrigger,
  nextRunAfter,
  sequenceGoal,
  summarizeEnrollments,
  triggerContext,
} from "./sequence-core";
import { type EventSummary, sequenceTrackingId, summarizeEvents } from "./tracking-core";

/**
 * Email sequences on the server: saving them, enrolling people when their
 * trigger happens, the runner that sends due steps, and the reports.
 * `processSequences` is only called by the comms runner (`runner.ts`).
 */

export type SequenceResult = { ok: true; sequence: EmailSequence } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const NOT_FOUND = "This sequence no longer exists.";

function copy(sequence: EmailSequence): EmailSequence {
  return { ...sequence, steps: sequence.steps.map((s) => ({ ...s })) };
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function applyDraft(row: EmailSequence, draft: SequenceDraft): void {
  const sentById = new Map(row.steps.map((s) => [s.id, s.sent] as const));
  row.name = draft.name;
  row.description = draft.description;
  row.trigger = draft.trigger;
  row.courseId = draft.courseId;
  row.inactiveDays = draft.inactiveDays;
  row.goal = draft.goal;
  row.steps = draft.steps.map((step): EmailSequenceStep => {
    const sent = sentById.get(step.id);
    return sent ? { ...step, sent } : step;
  });
}

/**
 * Create a sequence, or update one. When steps are reordered or removed,
 * people who are part-way through keep waiting for the same email (found by
 * its id); if that email was removed they continue with whatever now sits at
 * its position.
 */
export async function saveSequence(author: Pick<User, "id">, input: Record<string, unknown> & { id?: string; active?: boolean }): Promise<SequenceResult> {
  const now = new Date().toISOString();
  return mutate((db): SequenceResult => {
    const checked = checkSequence(input, new Set(db.courses.map((c) => c.id)));
    if (!checked.ok) return checked;
    if (input.id) {
      const row = db.emailSequences.find((s) => s.id === input.id);
      if (!row) return { ok: false, error: NOT_FOUND };
      const oldStepIds = row.steps.map((s) => s.id);
      applyDraft(row, checked.value);
      row.updatedAt = now;
      const newIndex = new Map(row.steps.map((s, i) => [s.id, i] as const));
      for (const enrollment of db.sequenceEnrollments.filter((e) => e.sequenceId === row.id && e.status === "active")) {
        const waitingFor = oldStepIds[enrollment.nextStepIndex];
        const moved = waitingFor ? newIndex.get(waitingFor) : undefined;
        if (moved !== undefined && moved !== enrollment.nextStepIndex) enrollment.nextStepIndex = moved;
      }
      return { ok: true, sequence: copy(row) };
    }
    const row: EmailSequence = { id: uid("seq"), name: "", trigger: checked.value.trigger, steps: [], active: !!input.active, createdAt: now, updatedAt: now, createdById: author.id };
    applyDraft(row, checked.value);
    if (row.active) row.activatedAt = now;
    db.emailSequences.push(row);
    return { ok: true, sequence: copy(row) };
  });
}

/** Switch a sequence on or off. While it is off nobody is enrolled and no step is sent; people part-way through continue when it is switched on again. */
export async function setSequenceActive(id: string, active: boolean): Promise<SequenceResult> {
  return mutate((db): SequenceResult => {
    const row = db.emailSequences.find((s) => s.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (active && row.steps.length === 0) return { ok: false, error: "Add at least one email before switching the sequence on." };
    if (active && !db.settings.email.enabled) return { ok: false, error: "Email is turned off. Switch it on in Settings → Email first." };
    if (row.active !== active) {
      const now = new Date().toISOString();
      row.active = active;
      if (active) row.activatedAt = now;
      row.updatedAt = now;
    }
    return { ok: true, sequence: copy(row) };
  });
}

/** A switched-off copy with fresh step ids and no history. */
export async function duplicateSequence(author: Pick<User, "id">, id: string): Promise<SequenceResult> {
  const now = new Date().toISOString();
  return mutate((db): SequenceResult => {
    const source = db.emailSequences.find((s) => s.id === id);
    if (!source) return { ok: false, error: NOT_FOUND };
    const row: EmailSequence = {
      id: uid("seq"),
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      trigger: source.trigger,
      courseId: source.courseId,
      inactiveDays: source.inactiveDays,
      goal: source.goal,
      steps: source.steps.map((s) => ({ id: uid("step"), delayHours: s.delayHours, subject: s.subject, body: s.body })),
      active: false,
      createdAt: now,
      updatedAt: now,
      createdById: author.id,
    };
    db.emailSequences.push(row);
    return { ok: true, sequence: copy(row) };
  });
}

/** Delete a sequence together with its enrollments. */
export async function deleteSequence(id: string): Promise<SequenceResult> {
  return mutate((db): SequenceResult => {
    const row = db.emailSequences.find((s) => s.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    db.emailSequences = db.emailSequences.filter((s) => s.id !== id);
    db.sequenceEnrollments = db.sequenceEnrollments.filter((e) => e.sequenceId !== id);
    return { ok: true, sequence: copy(row) };
  });
}

/* ------------------------------------------------------------------ */
/* Enrolling                                                           */
/* ------------------------------------------------------------------ */

export type SequencePerson = { kind: "member"; userId: string } | { kind: "lead"; leadId: string };

interface Candidate {
  sequenceId: string;
  person: SequencePerson;
  event: TriggerEvent;
}

function personKey(sequenceId: string, person: SequencePerson): string {
  return `${sequenceId}|${person.kind === "member" ? `m:${person.userId}` : `l:${person.leadId}`}`;
}

function enrollmentKey(e: Pick<SequenceEnrollment, "sequenceId" | "userId" | "leadId">): string {
  return `${e.sequenceId}|${e.userId ? `m:${e.userId}` : `l:${e.leadId ?? ""}`}`;
}

/** Members must be reachable in principle (an unverified address may still be confirmed); leads must have confirmed. */
function canStart(db: Pick<Database, "users" | "leads">, person: SequencePerson): { email: string; name: string } | null {
  if (person.kind === "member") {
    const user = db.users.find((u) => u.id === person.userId);
    if (!user) return null;
    const block = memberBlock(user);
    if (block && block !== "unconfirmed") return null;
    return { email: user.email.trim().toLowerCase(), name: user.name };
  }
  const lead = db.leads.find((l) => l.id === person.leadId);
  if (!lead || leadBlock(lead)) return null;
  return { email: lead.email.trim().toLowerCase(), name: lead.name?.trim() ?? "" };
}

/** Insert the enrollments that are still allowed (checked again inside the write). */
async function enrollCandidates(candidates: Candidate[], now: number): Promise<number> {
  if (!candidates.length) return 0;
  const nowIso = new Date(now).toISOString();
  return mutate((db) => {
    const wanted = new Set(candidates.map((c) => personKey(c.sequenceId, c.person)));
    const existing = new Map<string, SequenceEnrollment[]>();
    for (const e of db.sequenceEnrollments.filter((row) => wanted.has(enrollmentKey(row)))) {
      const key = enrollmentKey(e);
      const list = existing.get(key);
      if (list) list.push(e);
      else existing.set(key, [e]);
    }
    let enrolled = 0;
    for (const candidate of candidates) {
      const sequence = db.emailSequences.find((s) => s.id === candidate.sequenceId);
      if (!sequence || !matchesTrigger(sequence, candidate.event)) continue;
      const key = personKey(sequence.id, candidate.person);
      const context = triggerContext(candidate.event);
      const mine = existing.get(key) ?? [];
      if (!canEnroll(mine, context.contextKey)) continue;
      const who = canStart(db, candidate.person);
      if (!who) continue;
      const row: SequenceEnrollment = {
        id: uid("sqe"),
        sequenceId: sequence.id,
        email: who.email,
        nextStepIndex: 0,
        nextRunAt: new Date(firstRunAt(sequence.steps, now)).toISOString(),
        status: "active",
        createdAt: nowIso,
        contextKey: context.contextKey,
      };
      if (candidate.person.kind === "member") row.userId = candidate.person.userId;
      else row.leadId = candidate.person.leadId;
      if (who.name) row.name = who.name;
      const courseId = context.courseId ?? sequence.courseId;
      if (courseId) row.courseId = courseId;
      db.sequenceEnrollments.push(row);
      existing.set(key, [...mine, row]);
      enrolled++;
    }
    return enrolled;
  });
}

/** Start every active sequence whose trigger matches `event` for this person. Returns how many were started. */
export async function enrollInSequences(person: SequencePerson, event: TriggerEvent, now: number = Date.now()): Promise<number> {
  const db = await getDb();
  const matching = db.emailSequences.filter((s) => matchesTrigger(s, event));
  if (!matching.length) return 0;
  return enrollCandidates(
    matching.map((s) => ({ sequenceId: s.id, person, event })),
    now,
  );
}

/** Most people a sweep enrolls per run (the rest follow on the next runs). */
const SWEEP_LIMIT = 500;

function activatedAt(sequence: EmailSequence): number {
  const t = Date.parse(sequence.activatedAt ?? sequence.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Triggers without a dedicated event:
 *  - "lead": leads whose double opt-in was confirmed after the sequence was
 *    switched on (the confirmation happens on a public page long after
 *    `lead.created`);
 *  - "inactive": members who crossed the inactivity threshold.
 */
async function sweepTriggers(db: Database, now: number): Promise<number> {
  const leadSequences = db.emailSequences.filter((s) => s.active && s.trigger === "lead" && s.steps.length > 0);
  const inactiveSequences = db.emailSequences.filter((s) => s.active && s.trigger === "inactive" && s.steps.length > 0 && (s.inactiveDays ?? 0) > 0);
  if (!leadSequences.length && !inactiveSequences.length) return 0;

  const sequenceIds = new Set([...leadSequences, ...inactiveSequences].map((s) => s.id));
  const existing = new Map<string, SequenceEnrollment[]>();
  for (const e of db.sequenceEnrollments) {
    if (!sequenceIds.has(e.sequenceId)) continue;
    const key = enrollmentKey(e);
    const list = existing.get(key);
    if (list) list.push(e);
    else existing.set(key, [e]);
  }
  const candidates: Candidate[] = [];

  if (leadSequences.length) {
    const memberEmails = new Set(db.users.map((u) => u.email.trim().toLowerCase()));
    for (const lead of db.leads) {
      if (candidates.length >= SWEEP_LIMIT) break;
      if (!lead.confirmedAt || leadBlock(lead) || memberEmails.has(lead.email.trim().toLowerCase())) continue;
      const confirmed = Date.parse(lead.confirmedAt);
      const event: TriggerEvent = { trigger: "lead", courseId: lead.courseId };
      for (const sequence of leadSequences) {
        if (confirmed < activatedAt(sequence) || !matchesTrigger(sequence, event)) continue;
        const person: SequencePerson = { kind: "lead", leadId: lead.id };
        if (canEnroll(existing.get(personKey(sequence.id, person)) ?? [], "")) candidates.push({ sequenceId: sequence.id, person, event });
      }
    }
  }

  if (inactiveSequences.length) {
    const lastActive = lastActivityByUser(db);
    for (const user of db.users) {
      if (candidates.length >= SWEEP_LIMIT) break;
      // Win-back email is for learners, not for the team running the site.
      if (user.roles.includes("admin") || user.roles.includes("moderator") || memberBlock(user)) continue;
      const last = lastActive.get(user.id);
      if (last === undefined) continue;
      const event: TriggerEvent = { trigger: "inactive", lastActivityAt: last };
      for (const sequence of inactiveSequences) {
        if (!inactivityDue(last, sequence.inactiveDays!, activatedAt(sequence), now)) continue;
        const person: SequencePerson = { kind: "member", userId: user.id };
        if (canEnroll(existing.get(personKey(sequence.id, person)) ?? [], triggerContext(event).contextKey)) candidates.push({ sequenceId: sequence.id, person, event });
      }
    }
  }
  return enrollCandidates(candidates, now);
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

interface PersonIndex {
  usersById: Map<string, User>;
  usersByEmail: Map<string, User>;
  leadsById: Map<string, Lead>;
  paymentsByUser: Map<string, Payment[]>;
  enrollmentsByUser: Map<string, Enrollment[]>;
  lastActive: Map<string, number> | null;
}

function group<T extends { userId: string }>(rows: readonly T[], only?: ReadonlySet<string>): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    if (only && !only.has(row.userId)) continue;
    const list = out.get(row.userId);
    if (list) list.push(row);
    else out.set(row.userId, [row]);
  }
  return out;
}

function buildIndex(db: Database, needsActivity: boolean): PersonIndex {
  return {
    usersById: new Map(db.users.map((u) => [u.id, u] as const)),
    usersByEmail: new Map(db.users.map((u) => [u.email.trim().toLowerCase(), u] as const)),
    leadsById: new Map(db.leads.map((l) => [l.id, l] as const)),
    paymentsByUser: group(db.payments),
    enrollmentsByUser: group(db.enrollments),
    lastActive: needsActivity ? lastActivityByUser(db) : null,
  };
}

/** The account behind an enrollment: the member, or the account a lead created later. */
function accountOf(enrollment: SequenceEnrollment, index: PersonIndex): User | undefined {
  return enrollment.userId ? index.usersById.get(enrollment.userId) : index.usersByEmail.get(enrollment.email);
}

function goalFacts(enrollment: SequenceEnrollment, index: PersonIndex): GoalFacts {
  const account = accountOf(enrollment, index);
  return {
    since: Date.parse(enrollment.createdAt) || 0,
    courseId: enrollment.courseId,
    hasAccount: !!account,
    payments: account ? (index.paymentsByUser.get(account.id) ?? []) : [],
    enrollments: account ? (index.enrollmentsByUser.get(account.id) ?? []) : [],
    lastActivityAt: account ? index.lastActive?.get(account.id) : undefined,
  };
}

function endEnrollment(row: SequenceEnrollment, status: "completed" | "stopped", nowIso: string, reason?: SequenceStopReason): void {
  row.status = status;
  row.endedAt = nowIso;
  row.stopReason = status === "stopped" ? (reason ?? "manual") : undefined;
}

/**
 * Stop the active enrollments of one account whose goal just happened (a
 * purchase, an enrollment, a completed course, a new account for a lead's
 * address). Called from the domain event handlers, so a nurture sequence
 * ends the moment the person converts. Returns how many were stopped.
 */
export async function stopReachedGoals(userId: string, now: number = Date.now()): Promise<number> {
  const db = await getDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return 0;
  const email = user.email.trim().toLowerCase();
  const mine = db.sequenceEnrollments.filter((e) => e.status === "active" && (e.userId === userId || (!e.userId && e.email === email)));
  if (!mine.length) return 0;
  const sequences = new Map(db.emailSequences.map((s) => [s.id, s] as const));
  const only = new Set([userId]);
  const index: PersonIndex = {
    usersById: new Map([[user.id, user]]),
    usersByEmail: new Map([[email, user]]),
    leadsById: new Map(),
    paymentsByUser: group(db.payments, only),
    enrollmentsByUser: group(db.enrollments, only),
    // "Comes back" is judged by the runner, which looks at all activity.
    lastActive: null,
  };
  const reached = new Set(
    mine
      .filter((e) => {
        const sequence = sequences.get(e.sequenceId);
        return !!sequence && goalReached(sequenceGoal(sequence), goalFacts(e, index));
      })
      .map((e) => e.id),
  );
  if (!reached.size) return 0;
  const nowIso = new Date(now).toISOString();
  return mutate((live) => {
    let stopped = 0;
    for (const row of live.sequenceEnrollments.filter((e) => reached.has(e.id))) {
      if (row.status !== "active") continue;
      endEnrollment(row, "stopped", nowIso, "goal");
      stopped++;
    }
    return stopped;
  });
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface SequenceRunResult {
  enrolled: number;
  sent: number;
  completed: number;
  stopped: number;
  /** Earliest time more work is due (ms), or null when nothing is waiting. */
  nextAt: number | null;
  /** Email is switched off: nothing was sent. */
  emailDisabled?: boolean;
}

/** Steps sent per run; the rest follow on the next run. */
export const MAX_STEPS_PER_RUN = 200;
/** How often the lead and inactivity triggers are looked at when nothing else is due. */
export const SWEEP_INTERVAL_MS = 10 * 60_000;

interface Planned {
  enrollmentId: string;
  decision: StepDecision;
  /** For "send": the step, and whether the email still has to be queued. */
  sequenceId?: string;
  stepId?: string;
}

function deliveryState(enrollment: SequenceEnrollment, index: PersonIndex): { block: DeliveryBlock | "missing" | null; recipient: SegmentRecipient | null } {
  if (enrollment.userId) {
    const user = index.usersById.get(enrollment.userId);
    if (!user) return { block: "missing", recipient: null };
    return { block: memberBlock(user), recipient: memberRecipient(user) };
  }
  const lead = enrollment.leadId ? index.leadsById.get(enrollment.leadId) : undefined;
  if (!lead) return { block: "missing", recipient: null };
  let block = leadBlock(lead);
  if (!block) {
    // A lead who created an account since: respect what they chose there, too.
    const account = index.usersByEmail.get(enrollment.email);
    const accountBlock = account ? memberBlock(account) : null;
    if (accountBlock === "unsubscribed" || accountBlock === "disabled") block = accountBlock;
  }
  return { block, recipient: leadRecipient(lead) };
}

/**
 * Enroll people whose trigger has no event, then send every step that is
 * due. Each enrollment is judged by `decideStep` right before its email is
 * rendered: unsubscribed or unreachable people and people who reached the
 * goal are stopped instead. A step that is already in the outbox for this
 * enrollment is never queued twice.
 */
export async function processSequences(now: number = Date.now()): Promise<SequenceRunResult> {
  const result: SequenceRunResult = { enrolled: 0, sent: 0, completed: 0, stopped: 0, nextAt: null };
  let db = await getDb();
  const active = db.emailSequences.filter((s) => s.active);
  if (!active.length) return result;
  if (!db.settings.email.enabled) return { ...result, emailDisabled: true };

  result.enrolled = await sweepTriggers(db, now);
  if (result.enrolled) db = await getDb();
  if (active.some((s) => s.trigger === "lead" || s.trigger === "inactive")) result.nextAt = now + SWEEP_INTERVAL_MS;
  const later = (at: number) => {
    if (result.nextAt === null || at < result.nextAt) result.nextAt = at;
  };

  const sequences = new Map(active.map((s) => [s.id, s] as const));
  const due: SequenceEnrollment[] = [];
  for (const e of db.sequenceEnrollments) {
    if (e.status !== "active" || !sequences.has(e.sequenceId)) continue;
    const at = Date.parse(e.nextRunAt);
    if (Number.isNaN(at) || at <= now) due.push(e);
    else later(at);
  }
  if (!due.length) return result;
  due.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  if (due.length > MAX_STEPS_PER_RUN) {
    due.length = MAX_STEPS_PER_RUN;
    later(now);
  }

  const index = buildIndex(
    db,
    due.some((e) => sequenceGoal(sequences.get(e.sequenceId)!) === "return"),
  );
  const earliest = due.reduce((min, e) => (e.createdAt < min ? e.createdAt : min), due[0]!.createdAt);
  const inOutbox = new Map<string, string>();
  for (const email of db.emails) {
    if (!email.trackingId?.startsWith("sequence:") || email.createdAt < earliest) continue;
    const key = `${email.trackingId}|${email.to}`;
    const seen = inOutbox.get(key);
    if (!seen || email.createdAt > seen) inOutbox.set(key, email.createdAt);
  }
  const courses = new Map(db.courses.map((c) => [c.id, c] as const));
  const prepared = new Map<string, PreparedCampaign>();
  const prepare = (sequence: EmailSequence, step: EmailSequenceStep, course: Course | undefined): PreparedCampaign => {
    const key = `${sequence.id}|${step.id}|${course?.id ?? ""}`;
    let p = prepared.get(key);
    if (!p) {
      p = prepareCampaign(db.settings, step, courseValues(course, siteConfig.appUrl));
      prepared.set(key, p);
    }
    return p;
  };

  const plans: Planned[] = [];
  const inputs: EnqueueEmailInput[] = [];
  for (const enrollment of due) {
    const sequence = sequences.get(enrollment.sequenceId)!;
    const { block, recipient } = deliveryState(enrollment, index);
    const goal = goalReached(sequenceGoal(sequence), goalFacts(enrollment, index));
    const decision = decideStep({ steps: sequence.steps, enrollment, block, goal, now });
    if (decision.action !== "send" || !recipient) {
      plans.push({ enrollmentId: enrollment.id, decision: decision.action === "send" ? { action: "stop", reason: "undeliverable" } : decision });
      continue;
    }
    const step = sequence.steps[decision.stepIndex]!;
    const trackingId = sequenceTrackingId(sequence.id, step.id);
    plans.push({ enrollmentId: enrollment.id, decision, sequenceId: sequence.id, stepId: step.id });
    const queuedAt = inOutbox.get(`${trackingId}|${recipient.email}`);
    if (queuedAt && queuedAt >= enrollment.createdAt) continue;
    inOutbox.set(`${trackingId}|${recipient.email}`, new Date(now).toISOString());
    const rendered = renderCampaignEmail(prepare(sequence, step, courses.get(enrollment.courseId ?? sequence.courseId ?? "")), recipient);
    inputs.push({
      to: recipient.email,
      toName: recipient.name || undefined,
      userId: recipient.kind === "member" ? recipient.id : undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: "announcement",
      trackingId,
      trackOpens: true,
      trackClicks: true,
    });
  }
  await enqueueEmails(inputs);

  const nowIso = new Date(now).toISOString();
  const byId = new Map(plans.map((p) => [p.enrollmentId, p] as const));
  const next = await mutate((live) => {
    let nextAt: number | null = null;
    const sentPerStep = new Map<string, number>();
    for (const row of live.sequenceEnrollments.filter((e) => byId.has(e.id))) {
      if (row.status !== "active") continue;
      const plan = byId.get(row.id)!;
      const { decision } = plan;
      if (decision.action === "stop") {
        endEnrollment(row, "stopped", nowIso, decision.reason);
        result.stopped++;
      } else if (decision.action === "complete") {
        endEnrollment(row, "completed", nowIso);
        result.completed++;
      } else if (decision.action === "wait") {
        row.nextRunAt = new Date(decision.until).toISOString();
        if (nextAt === null || decision.until < nextAt) nextAt = decision.until;
      } else {
        const sequence = sequences.get(row.sequenceId)!;
        row.sentCount = (row.sentCount ?? 0) + 1;
        row.lastSentAt = nowIso;
        row.nextStepIndex = decision.stepIndex + 1;
        result.sent++;
        const stepKey = `${plan.sequenceId}|${plan.stepId}`;
        sentPerStep.set(stepKey, (sentPerStep.get(stepKey) ?? 0) + 1);
        const following = nextRunAfter(sequence.steps, decision.stepIndex, now);
        if (following === null) {
          endEnrollment(row, "completed", nowIso);
          result.completed++;
        } else {
          row.nextRunAt = new Date(following).toISOString();
          if (nextAt === null || following < nextAt) nextAt = following;
        }
      }
    }
    for (const [key, count] of sentPerStep) {
      const [sequenceId, stepId] = key.split("|");
      const step = live.emailSequences.find((s) => s.id === sequenceId)?.steps.find((s) => s.id === stepId);
      if (step) step.sent = (step.sent ?? 0) + count;
    }
    return nextAt;
  });
  if (next !== null) later(next);
  return result;
}

/* ------------------------------------------------------------------ */
/* Manual control                                                      */
/* ------------------------------------------------------------------ */

/** Stop one person's enrollment by hand. */
export async function stopEnrollment(enrollmentId: string): Promise<{ ok: true; sequenceId: string } | { ok: false; error: string }> {
  return mutate((db) => {
    const row = db.sequenceEnrollments.find((e) => e.id === enrollmentId);
    if (!row) return { ok: false as const, error: "This person is no longer in the sequence." };
    if (row.status !== "active") return { ok: false as const, error: "This person has already finished the sequence." };
    endEnrollment(row, "stopped", new Date().toISOString(), "manual");
    return { ok: true as const, sequenceId: row.sequenceId };
  });
}

/** Stop everyone who is part-way through a sequence. Returns how many were stopped. */
export async function stopActiveEnrollments(sequenceId: string): Promise<number> {
  return mutate((db) => {
    const nowIso = new Date().toISOString();
    const rows = db.sequenceEnrollments.filter((e) => e.sequenceId === sequenceId && e.status === "active");
    for (const row of rows) endEnrollment(row, "stopped", nowIso, "manual");
    return rows.length;
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface SequenceListItem {
  sequence: EmailSequence;
  triggerLabel: string;
  summary: EnrollmentSummary;
  /** Emails handed to the outbox across all steps. */
  sent: number;
  uniqueOpens: number;
  uniqueClicks: number;
}

export interface SequenceListFilters {
  status: "all" | "active" | "paused";
  q: string;
}

export function parseSequenceFilters(params: Record<string, string | string[] | undefined>): SequenceListFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = first(params.status);
  return { status: status === "active" || status === "paused" ? status : "all", q: first(params.q).trim().slice(0, 120) };
}

function courseTitles(db: Pick<Database, "courses">): (courseId: string) => string | undefined {
  const titles = new Map(db.courses.map((c) => [c.id, c.title] as const));
  return (courseId) => titles.get(courseId);
}

function sentTotal(sequence: Pick<EmailSequence, "steps">): number {
  return sequence.steps.reduce((sum, step) => sum + (step.sent ?? 0), 0);
}

export async function listSequences(filters: SequenceListFilters): Promise<{ rows: SequenceListItem[]; total: number; counts: { all: number; active: number; paused: number } }> {
  const db = await getDb();
  const q = filters.q.toLowerCase();
  const titleOf = courseTitles(db);
  const searched = db.emailSequences.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q));
  const counts = { all: searched.length, active: searched.filter((s) => s.active).length, paused: 0 };
  counts.paused = counts.all - counts.active;
  const matching = searched.filter((s) => filters.status === "all" || (filters.status === "active") === s.active);

  const enrollments = new Map<string, SequenceEnrollment[]>();
  for (const e of db.sequenceEnrollments) {
    const list = enrollments.get(e.sequenceId);
    if (list) list.push(e);
    else enrollments.set(e.sequenceId, [e]);
  }
  const events = new Map<string, typeof db.emailEvents>();
  for (const event of db.emailEvents) {
    if (!event.trackingId?.startsWith("sequence:")) continue;
    const sequenceId = event.trackingId.split(":")[1]!;
    const list = events.get(sequenceId);
    if (list) list.push(event);
    else events.set(sequenceId, [event]);
  }

  const rows = matching
    .map((sequence): SequenceListItem => {
      const summary = summarizeEvents(events.get(sequence.id) ?? []);
      return {
        sequence: copy(sequence),
        triggerLabel: describeTrigger(sequence, titleOf),
        summary: summarizeEnrollments(enrollments.get(sequence.id) ?? []),
        sent: sentTotal(sequence),
        uniqueOpens: summary.uniqueOpens,
        uniqueClicks: summary.uniqueClicks,
      };
    })
    .sort((a, b) => Number(b.sequence.active) - Number(a.sequence.active) || (b.sequence.updatedAt ?? b.sequence.createdAt).localeCompare(a.sequence.updatedAt ?? a.sequence.createdAt));
  return { rows, total: searched.length, counts };
}

export interface SequenceStepReport {
  step: EmailSequenceStep;
  /** Hours from the trigger when every step goes out on time. */
  offsetHours: number;
  sent: number;
  uniqueOpens: number;
  uniqueClicks: number;
  /** People whose next email is this one. */
  waiting: number;
}

export interface SequenceReport {
  sequence: EmailSequence;
  triggerLabel: string;
  courseTitle: string | null;
  summary: EnrollmentSummary;
  steps: SequenceStepReport[];
  sent: number;
  /** Opens, clicks and links across every step. */
  events: EventSummary;
  emailEnabled: boolean;
}

export async function getSequence(id: string): Promise<EmailSequence | null> {
  const db = await getDb();
  const row = db.emailSequences.find((s) => s.id === id);
  return row ? copy(row) : null;
}

export async function getSequenceReport(id: string): Promise<SequenceReport | null> {
  const db = await getDb();
  const sequence = db.emailSequences.find((s) => s.id === id);
  if (!sequence) return null;
  const titleOf = courseTitles(db);
  const enrollments = db.sequenceEnrollments.filter((e) => e.sequenceId === id);
  const prefix = `sequence:${id}:`;
  const all = db.emailEvents.filter((e) => e.trackingId?.startsWith(prefix));
  const perStep = new Map<string, typeof all>();
  for (const event of all) {
    const list = perStep.get(event.trackingId!);
    if (list) list.push(event);
    else perStep.set(event.trackingId!, [event]);
  }
  const offsets = cumulativeDelayHours(sequence.steps);
  const waiting = new Map<number, number>();
  for (const e of enrollments) if (e.status === "active") waiting.set(e.nextStepIndex, (waiting.get(e.nextStepIndex) ?? 0) + 1);
  return {
    sequence: copy(sequence),
    triggerLabel: describeTrigger(sequence, titleOf),
    courseTitle: sequence.courseId ? (titleOf(sequence.courseId) ?? null) : null,
    summary: summarizeEnrollments(enrollments),
    steps: sequence.steps.map((step, i) => {
      const summary = summarizeEvents(perStep.get(sequenceTrackingId(id, step.id)) ?? []);
      return { step: { ...step }, offsetHours: offsets[i] ?? 0, sent: step.sent ?? 0, uniqueOpens: summary.uniqueOpens, uniqueClicks: summary.uniqueClicks, waiting: waiting.get(i) ?? 0 };
    }),
    sent: sentTotal(sequence),
    events: summarizeEvents(all),
    emailEnabled: db.settings.email.enabled,
  };
}

export interface EnrollmentPage {
  rows: SequenceEnrollment[];
  total: number;
  page: number;
  pageCount: number;
}

/** People in a sequence, newest first, filtered by state and a search over name and address. */
export async function listSequenceEnrollments(sequenceId: string, filters: EnrollmentFilters, opts: { all?: boolean } = {}): Promise<EnrollmentPage> {
  const db = await getDb();
  const q = filters.q.toLowerCase();
  const rows = db.sequenceEnrollments
    .filter((e) => e.sequenceId === sequenceId && (filters.status === "all" || e.status === filters.status) && (!q || e.email.includes(q) || (e.name ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const total = rows.length;
  if (opts.all) return { rows: rows.map((r) => ({ ...r })), total, page: 1, pageCount: 1 };
  const pageCount = Math.max(1, Math.ceil(total / ENROLLMENTS_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return { rows: rows.slice((page - 1) * ENROLLMENTS_PAGE_SIZE, page * ENROLLMENTS_PAGE_SIZE).map((r) => ({ ...r })), total, page, pageCount };
}
