import "server-only";
import type { Broadcast, Database, Lead, SegmentFilter, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { type EnqueueEmailInput, enqueueEmails } from "@/lib/email/outbox";
import { notify } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import {
  BROADCASTS_PAGE_SIZE,
  MAX_BATCH_SIZE,
  type BroadcastListFilters,
  filterBroadcasts,
  isEditable,
  normalizeRate,
  parseScheduleTime,
  throttleAllowance,
} from "./broadcast-core";
import { checkContent, parseRecipientRef, recipientRef } from "./campaign-core";
import { prepareCampaign, renderCampaignEmail } from "./render";
import { describeSegment, evaluateSegment, leadBlock, leadRecipient, memberBlock, memberRecipient, normalizeSegmentFilter, segmentInputProblem, staleSegmentCourses, type SegmentRecipient } from "./segments";
import { getCampaignEventSummary } from "./tracking";
import { broadcastTrackingId, type EventSummary } from "./tracking-core";

/**
 * Broadcasts on the server: drafts, scheduling, the throttled sender and the
 * report. Batches are only sent by the comms runner (`runner.ts`), which
 * makes sure a single run is active per process.
 */

export type BroadcastResult = { ok: true; broadcast: Broadcast } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const NOT_FOUND = "This broadcast no longer exists.";
const EMAIL_OFF = "Email is turned off. Switch it on in Settings → Email before sending a broadcast.";

/** A detached snapshot of a row (the send queue is shared, never edited through a snapshot). */
function copy(b: Broadcast): Broadcast {
  return { ...b, segment: { ...b.segment } };
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export interface BroadcastDraftInput {
  id?: string;
  subject: unknown;
  preheader?: unknown;
  body: unknown;
  segment: unknown;
}

/** Create a draft, or update a draft or scheduled broadcast. */
export async function saveBroadcast(author: Pick<User, "id">, input: BroadcastDraftInput): Promise<BroadcastResult> {
  const checked = checkContent(input, "broadcast");
  if (Object.keys(checked.errors).length) return { ok: false, error: "Check the highlighted fields.", fieldErrors: checked.errors };
  const now = new Date().toISOString();
  return mutate((db): BroadcastResult => {
    const knownCourseIds = new Set(db.courses.map((c) => c.id));
    // Never save an audience that silently fell back to "All members".
    const problem = segmentInputProblem(input.segment, knownCourseIds);
    if (problem) return { ok: false, error: problem, fieldErrors: { segment: problem } };
    const segment = normalizeSegmentFilter(input.segment, knownCourseIds);
    if (input.id) {
      const row = db.broadcasts.find((b) => b.id === input.id);
      if (!row) return { ok: false, error: NOT_FOUND };
      if (!isEditable(row)) return { ok: false, error: "This broadcast is already being sent and can't be edited. Duplicate it to send a new version." };
      row.subject = checked.value.subject;
      row.body = checked.value.body;
      row.preheader = checked.value.preheader;
      row.segment = segment;
      row.updatedAt = now;
      return { ok: true, broadcast: copy(row) };
    }
    const row: Broadcast = {
      id: uid("bc"),
      subject: checked.value.subject,
      body: checked.value.body,
      segment,
      status: "draft",
      recipients: 0,
      opens: 0,
      clicks: 0,
      createdById: author.id,
      createdAt: now,
      updatedAt: now,
    };
    if (checked.value.preheader) row.preheader = checked.value.preheader;
    db.broadcasts.push(row);
    return { ok: true, broadcast: copy(row) };
  });
}

/** A new draft with the same message and audience. */
export async function duplicateBroadcast(author: Pick<User, "id">, id: string): Promise<BroadcastResult> {
  const now = new Date().toISOString();
  return mutate((db): BroadcastResult => {
    const source = db.broadcasts.find((b) => b.id === id);
    if (!source) return { ok: false, error: NOT_FOUND };
    const row: Broadcast = {
      id: uid("bc"),
      subject: source.subject,
      body: source.body,
      segment: normalizeSegmentFilter(source.segment),
      status: "draft",
      recipients: 0,
      opens: 0,
      clicks: 0,
      createdById: author.id,
      createdAt: now,
      updatedAt: now,
    };
    if (source.preheader) row.preheader = source.preheader;
    db.broadcasts.push(row);
    return { ok: true, broadcast: copy(row) };
  });
}

/** Delete a broadcast. One that is actively sending has to be paused or stopped first. */
export async function deleteBroadcast(id: string): Promise<BroadcastResult> {
  return mutate((db): BroadcastResult => {
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (row.status === "sending" && !row.pausedAt) return { ok: false, error: "This broadcast is being sent. Pause or stop it before deleting it." };
    db.broadcasts = db.broadcasts.filter((b) => b.id !== id);
    return { ok: true, broadcast: copy(row) };
  });
}

/* ------------------------------------------------------------------ */
/* Scheduling and sending                                              */
/* ------------------------------------------------------------------ */

export async function scheduleBroadcast(id: string, at: unknown, rate: unknown, now: number = Date.now()): Promise<BroadcastResult> {
  const parsed = parseScheduleTime(at, now);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return mutate((db): BroadcastResult => {
    if (!db.settings.email.enabled) return { ok: false, error: EMAIL_OFF };
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (!isEditable(row)) return { ok: false, error: "This broadcast has already been sent." };
    const checked = checkContent(row, "broadcast");
    if (Object.keys(checked.errors).length) return { ok: false, error: "The message isn't ready to send yet. Open it and fix the highlighted fields." };
    row.status = "scheduled";
    row.scheduledAt = parsed.at;
    row.ratePerMinute = normalizeRate(rate);
    row.updatedAt = new Date(now).toISOString();
    return { ok: true, broadcast: copy(row) };
  });
}

/** Back to a draft. */
export async function unscheduleBroadcast(id: string): Promise<BroadcastResult> {
  return mutate((db): BroadcastResult => {
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (row.status !== "scheduled") return { ok: false, error: "This broadcast isn't scheduled." };
    row.status = "draft";
    row.scheduledAt = undefined;
    row.updatedAt = new Date().toISOString();
    return { ok: true, broadcast: copy(row) };
  });
}

/**
 * Capture the recipient list and move the broadcast to "sending". The
 * batches themselves are queued by `processBroadcasts`.
 */
export async function startBroadcast(id: string, opts: { rate?: unknown; now?: number } = {}): Promise<BroadcastResult> {
  const now = opts.now ?? Date.now();
  const db = await getDb();
  if (!db.settings.email.enabled) return { ok: false, error: EMAIL_OFF };
  const current = db.broadcasts.find((b) => b.id === id);
  if (!current) return { ok: false, error: NOT_FOUND };
  if (!isEditable(current)) return { ok: false, error: current.status === "sending" ? "This broadcast is already being sent." : "This broadcast has already been sent." };
  const checked = checkContent(current, "broadcast");
  if (Object.keys(checked.errors).length) return { ok: false, error: "The message isn't ready to send yet. Open it and fix the highlighted fields.", fieldErrors: checked.errors };
  // A course deleted after the draft was saved would change who the audience reaches
  // ("not enrolled in" a deleted course matches everyone), so refuse to send until it's chosen again.
  if (staleSegmentCourses(current.segment, new Set(db.courses.map((c) => c.id)))) {
    return { ok: false, error: "A course in this audience no longer exists. Edit the audience and choose the courses again before sending." };
  }
  const { recipients } = evaluateSegment(db, current.segment, now);
  if (!recipients.length) return { ok: false, error: "Nobody matches this audience right now, so there is no one to send to. Adjust the audience and try again." };
  const refs = recipients.map(recipientRef);
  const nowIso = new Date(now).toISOString();
  return mutate((live): BroadcastResult => {
    const row = live.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (!isEditable(row)) return { ok: false, error: "This broadcast is already being sent." };
    row.status = "sending";
    row.pending = refs;
    row.recipients = refs.length;
    row.queued = 0;
    row.skipped = 0;
    row.delivered = 0;
    row.failed = 0;
    row.startedAt = nowIso;
    row.ratePerMinute = normalizeRate(opts.rate ?? row.ratePerMinute);
    row.windowStartedAt = undefined;
    row.windowCount = undefined;
    row.pausedAt = undefined;
    row.canceledAt = undefined;
    row.updatedAt = nowIso;
    return { ok: true, broadcast: copy(row) };
  });
}

export async function pauseBroadcast(id: string): Promise<BroadcastResult> {
  return mutate((db): BroadcastResult => {
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (row.status !== "sending") return { ok: false, error: "This broadcast isn't being sent." };
    row.pausedAt ??= new Date().toISOString();
    row.updatedAt = new Date().toISOString();
    return { ok: true, broadcast: copy(row) };
  });
}

export async function resumeBroadcast(id: string): Promise<BroadcastResult> {
  return mutate((db): BroadcastResult => {
    if (!db.settings.email.enabled) return { ok: false, error: EMAIL_OFF };
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (row.status !== "sending" || !row.pausedAt) return { ok: false, error: "This broadcast isn't paused." };
    row.pausedAt = undefined;
    row.updatedAt = new Date().toISOString();
    return { ok: true, broadcast: copy(row) };
  });
}

/** Stop a send for good: recipients not queued yet won't receive the email. */
export async function cancelBroadcast(id: string): Promise<BroadcastResult> {
  return mutate((db): BroadcastResult => {
    const row = db.broadcasts.find((b) => b.id === id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (row.status !== "sending") return { ok: false, error: "This broadcast isn't being sent." };
    const now = new Date().toISOString();
    row.status = "sent";
    row.sentAt = now;
    row.canceledAt = now;
    row.pausedAt = undefined;
    row.pending = undefined;
    row.updatedAt = now;
    return { ok: true, broadcast: copy(row) };
  });
}

export interface BroadcastRunResult {
  /** Scheduled broadcasts whose send started in this run. */
  started: number;
  queued: number;
  skipped: number;
  finished: number;
  /** Broadcasts still sending after this run. */
  sending: number;
  /** Earliest time more work is due (ms), or null when nothing is waiting. */
  nextAt: number | null;
  /** Email is switched off: nothing was sent. */
  emailDisabled?: boolean;
}

function resolveRecipient(ref: string, users: Map<string, User>, leads: Map<string, Lead>): SegmentRecipient | null {
  const parsed = parseRecipientRef(ref);
  if (!parsed) return null;
  if (parsed.kind === "member") {
    const user = users.get(parsed.id);
    return user && !memberBlock(user) ? memberRecipient(user) : null;
  }
  const lead = leads.get(parsed.id);
  return lead && !leadBlock(lead) ? leadRecipient(lead) : null;
}

interface BatchOutcome {
  queued: number;
  skipped: number;
  finished: boolean;
  /** When the throttle allows the next batch (ms); null when finished or not sending. */
  nextAt: number | null;
}

/**
 * Queue the next batch of one broadcast, within its throttle. Every
 * recipient is checked again right before the email is rendered (someone who
 * unsubscribed since the list was built is skipped), and an address that
 * already has this broadcast in the outbox is never queued twice — which
 * also makes a crash between queueing and bookkeeping harmless.
 */
async function sendNextBatch(id: string, now: number): Promise<BatchOutcome> {
  const db = await getDb();
  const broadcast = db.broadcasts.find((b) => b.id === id);
  if (!broadcast || broadcast.status !== "sending" || broadcast.pausedAt) return { queued: 0, skipped: 0, finished: false, nextAt: null };
  const pending = broadcast.pending ?? [];
  const throttle = throttleAllowance(broadcast, now);
  const take = Math.min(throttle.allowance, MAX_BATCH_SIZE, pending.length);
  if (pending.length > 0 && take === 0) return { queued: 0, skipped: 0, finished: false, nextAt: throttle.nextAt };

  const refs = pending.slice(0, take);
  const trackingId = broadcastTrackingId(broadcast.id);
  const inputs: EnqueueEmailInput[] = [];
  let alreadyQueued = 0;
  let skipped = 0;
  if (refs.length) {
    const inOutbox = new Set<string>();
    for (const email of db.emails) if (email.trackingId === trackingId) inOutbox.add(email.to);
    const users = new Map(db.users.map((u) => [u.id, u] as const));
    const leads = new Map(db.leads.map((l) => [l.id, l] as const));
    const prepared = prepareCampaign(db.settings, broadcast);
    for (const ref of refs) {
      const recipient = resolveRecipient(ref, users, leads);
      if (!recipient) {
        skipped++;
        continue;
      }
      if (inOutbox.has(recipient.email)) {
        alreadyQueued++;
        continue;
      }
      inOutbox.add(recipient.email);
      const rendered = renderCampaignEmail(prepared, recipient);
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
  }

  const nowIso = new Date(now).toISOString();
  return mutate((live): BatchOutcome => {
    const row = live.broadcasts.find((b) => b.id === id);
    // Stopped or deleted while the batch was being queued: nothing left to record.
    if (!row || row.status !== "sending") return { queued: inputs.length, skipped, finished: false, nextAt: null };
    const done = new Set(refs);
    const rest = (row.pending ?? []).filter((ref) => !done.has(ref));
    row.queued = (row.queued ?? 0) + inputs.length + alreadyQueued;
    row.skipped = (row.skipped ?? 0) + skipped;
    row.windowStartedAt = new Date(throttle.windowStartedAt).toISOString();
    row.windowCount = throttle.windowCount + refs.length;
    row.updatedAt = nowIso;
    if (rest.length === 0) {
      row.status = "sent";
      row.sentAt = nowIso;
      row.pending = undefined;
      row.pausedAt = undefined;
      return { queued: inputs.length, skipped, finished: true, nextAt: null };
    }
    row.pending = rest;
    const more = throttle.allowance - refs.length > 0;
    return { queued: inputs.length, skipped, finished: false, nextAt: more ? now : throttle.nextAt };
  });
}

async function announceFinished(id: string): Promise<void> {
  const db = await getDb();
  const b = db.broadcasts.find((x) => x.id === id);
  if (!b) return;
  await audit(null, "broadcast.sent", { type: "broadcast", id: b.id }, { recipients: b.recipients, queued: b.queued ?? 0, skipped: b.skipped ?? 0 });
  if (db.users.some((u) => u.id === b.createdById)) {
    await notify(b.createdById, {
      type: "system",
      subject: `Your broadcast “${b.subject}” has been sent`,
      message: `${b.queued ?? 0} ${(b.queued ?? 0) === 1 ? "email was" : "emails were"} queued for delivery. Opens and clicks appear in the report as they come in.`,
      link: `/admin/broadcasts/${b.id}`,
      email: false,
      dedupeKey: `broadcast-sent:${b.id}`,
    });
  }
}

/** A scheduled broadcast that reaches nobody goes back to a draft and its author is told. */
async function returnToDraft(id: string, reason: string): Promise<void> {
  const row = await mutate((db) => {
    const b = db.broadcasts.find((x) => x.id === id);
    if (!b || b.status !== "scheduled") return null;
    b.status = "draft";
    b.scheduledAt = undefined;
    b.updatedAt = new Date().toISOString();
    return { id: b.id, subject: b.subject, createdById: b.createdById };
  });
  if (!row) return;
  await notify(row.createdById, {
    type: "system",
    subject: `Your scheduled broadcast “${row.subject}” was not sent`,
    message: reason,
    link: `/admin/broadcasts/${row.id}`,
    email: false,
  });
}

/**
 * Start scheduled broadcasts that are due and queue batches for every
 * broadcast that is sending, as far as the throttles allow. Called by the
 * comms runner only.
 */
export async function processBroadcasts(now: number = Date.now()): Promise<BroadcastRunResult> {
  const result: BroadcastRunResult = { started: 0, queued: 0, skipped: 0, finished: 0, sending: 0, nextAt: null };
  const later = (at: number | null) => {
    if (at !== null && (result.nextAt === null || at < result.nextAt)) result.nextAt = at;
  };
  const db = await getDb();
  if (!db.settings.email.enabled) {
    result.emailDisabled = true;
    result.sending = db.broadcasts.filter((b) => b.status === "sending").length;
    return result;
  }

  for (const b of db.broadcasts.filter((x) => x.status === "scheduled")) {
    const at = b.scheduledAt ? Date.parse(b.scheduledAt) : NaN;
    if (Number.isNaN(at)) {
      await returnToDraft(b.id, "Its scheduled time could not be read. Open the broadcast and schedule it again.");
    } else if (at > now) {
      later(at);
    } else {
      const started = await startBroadcast(b.id, { now });
      if (started.ok) {
        result.started++;
        await audit(null, "broadcast.send", { type: "broadcast", id: b.id }, { scheduled: true, recipients: started.broadcast.recipients });
      } else {
        await returnToDraft(b.id, started.error);
      }
    }
  }

  const sending = (await getDb()).broadcasts.filter((b) => b.status === "sending" && !b.pausedAt).map((b) => b.id);
  for (const id of sending) {
    // Several batches per run, until this minute's allowance is used up.
    for (;;) {
      const outcome = await sendNextBatch(id, now);
      result.queued += outcome.queued;
      result.skipped += outcome.skipped;
      if (outcome.finished) {
        result.finished++;
        await announceFinished(id);
        break;
      }
      if (outcome.nextAt === null) break;
      if (outcome.nextAt > now) {
        later(outcome.nextAt);
        result.sending++;
        break;
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface BroadcastListItem {
  broadcast: Broadcast;
  authorName: string;
}

export interface BroadcastList {
  rows: BroadcastListItem[];
  total: number;
  page: number;
  pageCount: number;
  /** Broadcasts per status, ignoring the status filter (for the tabs). */
  counts: Record<Broadcast["status"], number> & { all: number };
}

function authorNames(db: Pick<Database, "users">): (userId: string) => string {
  const names = new Map(db.users.map((u) => [u.id, u.name] as const));
  return (userId) => names.get(userId) ?? "Former member";
}

export async function listBroadcasts(filters: BroadcastListFilters, opts: { all?: boolean } = {}): Promise<BroadcastList> {
  const db = await getDb();
  const searched = filterBroadcasts(db.broadcasts, { status: "all", q: filters.q });
  const counts = { all: searched.length, draft: 0, scheduled: 0, sending: 0, sent: 0 };
  for (const b of searched) counts[b.status]++;
  const matching = filters.status === "all" ? searched : searched.filter((b) => b.status === filters.status);
  const nameOf = authorNames(db);
  const total = matching.length;
  const pageCount = opts.all ? 1 : Math.max(1, Math.ceil(total / BROADCASTS_PAGE_SIZE));
  const page = opts.all ? 1 : Math.min(filters.page, pageCount);
  const slice = opts.all ? matching : matching.slice((page - 1) * BROADCASTS_PAGE_SIZE, page * BROADCASTS_PAGE_SIZE);
  return { rows: slice.map((b) => ({ broadcast: copy(b), authorName: nameOf(b.createdById) })), total, page, pageCount, counts };
}

export interface BroadcastOverview {
  /** Broadcasts that finished sending in the last 30 days. */
  sentLast30Days: number;
  emailsLast30Days: number;
  /** Average rates of those broadcasts, weighted by emails. */
  openRate: number;
  clickRate: number;
  scheduled: number;
  nextScheduledAt: string | null;
}

export async function getBroadcastOverview(now: number = Date.now()): Promise<BroadcastOverview> {
  const db = await getDb();
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const recent = db.broadcasts.filter((b) => b.status === "sent" && (b.sentAt ?? "") >= since);
  let emails = 0;
  let opens = 0;
  let clicks = 0;
  for (const b of recent) {
    const base = (b.delivered ?? 0) || (b.queued ?? 0);
    emails += base;
    opens += Math.min(b.opens ?? 0, base);
    clicks += Math.min(b.clicks ?? 0, base);
  }
  const scheduled = db.broadcasts.filter((b) => b.status === "scheduled" && b.scheduledAt).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  return {
    sentLast30Days: recent.length,
    emailsLast30Days: emails,
    openRate: emails ? Math.round((opens / emails) * 1000) / 10 : 0,
    clickRate: emails ? Math.round((clicks / emails) * 1000) / 10 : 0,
    scheduled: scheduled.length,
    nextScheduledAt: scheduled[0]?.scheduledAt ?? null,
  };
}

export interface BroadcastReport {
  broadcast: Broadcast;
  authorName: string;
  /** Human-readable audience conditions. */
  conditions: string[];
  segment: SegmentFilter;
  /** Opens, clicks and per-link numbers from the recorded events. */
  events: EventSummary;
  /** Emails of this broadcast still waiting in the outbox. */
  waiting: number;
  emailEnabled: boolean;
}

export async function getBroadcastReport(id: string): Promise<BroadcastReport | null> {
  const db = await getDb();
  const broadcast = db.broadcasts.find((b) => b.id === id);
  if (!broadcast) return null;
  const titles = new Map(db.courses.map((c) => [c.id, c.title] as const));
  const trackingId = broadcastTrackingId(id);
  let waiting = 0;
  if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
    for (const e of db.emails) if (e.trackingId === trackingId && (e.status === "queued" || e.status === "sending")) waiting++;
  }
  return {
    broadcast: copy(broadcast),
    authorName: authorNames(db)(broadcast.createdById),
    conditions: describeSegment(broadcast.segment, (courseId) => titles.get(courseId)),
    segment: normalizeSegmentFilter(broadcast.segment),
    events: await getCampaignEventSummary(trackingId),
    waiting,
    emailEnabled: db.settings.email.enabled,
  };
}

export async function getBroadcast(id: string): Promise<Broadcast | null> {
  const db = await getDb();
  const row = db.broadcasts.find((b) => b.id === id);
  return row ? copy(row) : null;
}
