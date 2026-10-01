import "server-only";
import type { EmailCategory, EmailMessage, EmailStatus, Settings } from "@/lib/types";
import { findById, getDb, getSettings, mutate } from "@/lib/db/store";
import { mailEnv } from "@/lib/server-env";
import { uid } from "@/lib/utils";
import { buildMimeMessage, createMessageId, decodeWords, domainOf, isSafeAddress, sanitizeHeaderValue } from "./mime";
import { htmlToText } from "./html";
import { SmtpError } from "./smtp";
import { type DeliveryAgent, type SenderIdentity, createDeliveryAgent, resolveReplyTo, resolveSender } from "./transport";
import { brandFromSettings } from "./context";
import { wrapHtmlFragment } from "./templates/layout";
import { findUnsubscribeScope, oneClickUnsubscribeUrl, preferencesUrl } from "./signing";
import { AUTH_TOKEN_TTL_MS } from "@/lib/auth/tokens";
import { SENSITIVE_EMAIL_CATEGORIES, TRANSACTIONAL_EMAIL_CATEGORIES } from "./preferences";
import { addEmailTracking } from "@/lib/comms/tracking";
import { normalizeTrackingId, stripTracking } from "@/lib/comms/tracking-core";

/**
 * The outbox: every email is an `EmailMessage` row in the JSON store.
 *
 *  queued ──claim──▶ sending ──▶ sent
 *     ▲                 │
 *     └── retry (1m, 5m, 30m, 2h, 12h) ◀── transient failure
 *                       └──▶ failed (permanent error, 6th failed attempt,
 *                             or a one-time link that expired first)
 *
 * `enqueueEmail` stores a message and schedules a fire-and-forget delivery
 * run. `deliverDueEmails` is the runner (also called by the cron route and
 * the admin outbox); a process-wide guard makes sure only one run is active,
 * and each message is claimed atomically inside `mutate`, so a message is
 * never sent twice concurrently. A "sending" row whose lease expired (crash
 * mid-send) is picked up again.
 */

export interface EnqueueEmailInput {
  to: string;
  toName?: string;
  cc?: string[];
  userId?: string;
  subject: string;
  /** Full HTML body (already rendered and escaped). A fragment is wrapped in the branded layout. */
  html: string;
  /** Plain-text alternative. Derived from the HTML when omitted. */
  text?: string;
  category: EmailCategory;
  /** Campaign reference stored on the message (`broadcastTrackingId` / `sequenceTrackingId` from `@/lib/comms/tracking-core`). */
  trackingId?: string;
  /** Add an open-tracking pixel (only when Settings → email tracking allows it). */
  trackOpens?: boolean;
  /** Send links through the signed click redirect (only when Settings → email tracking allows it). */
  trackClicks?: boolean;
}

export interface EnqueueOptions {
  /** Deliver immediately and resolve with the final state (used for test emails). */
  deliverNow?: boolean;
}

/** Attempts before a message is marked failed: the first try plus one retry per delay below. */
export const MAX_ATTEMPTS = 6;
/** Wait after the n-th failed attempt (index n-1): every delay is used once. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
/** A claimed message is considered abandoned after this long in "sending". */
const SENDING_LEASE_MS = 10 * 60_000;
/** Pause automatic runs after a connection-level failure. */
const CONNECTION_COOLDOWN_MS = 60_000;
/**
 * Pause automatic runs this long when the configuration makes delivery
 * impossible (no sender address): retrying cannot help until an admin fixes
 * .env and restarts, so the runner must not spin.
 */
const CONFIG_COOLDOWN_MS = 30 * 60_000;
const NO_SENDER_ERROR = "No sender address: set MAIL_FROM (or an email-address SMTP_USER) in .env and restart the server.";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CC = 50;
export const DEFAULT_RUN_LIMIT = 50;

export function retryDelayMs(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1]!;
}

/* ------------------------------------------------------------------ */
/* Runner state (per process, survives dev hot reloads)                */
/* ------------------------------------------------------------------ */

export interface DeliveryRunResult {
  ran: boolean;
  reason?: "already_running" | "cooldown" | "no_sender";
  transport: "log" | "smtp";
  startedAt: string;
  durationMs: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** First connection-level error, if the run stopped early. */
  error?: string;
}

interface RunnerState {
  running: Promise<DeliveryRunResult> | null;
  rerun: boolean;
  timer: NodeJS.Timeout | null;
  timerAt: number;
  cooldownUntil: number;
  lastRun: DeliveryRunResult | null;
  bootstrapped: boolean;
  /** Configuration problem that stops every delivery (shown to admins). */
  configError: string | null;
}

const g = globalThis as unknown as { __llEmailRunner?: RunnerState };
function runner(): RunnerState {
  return (g.__llEmailRunner ??= {
    running: null,
    rerun: false,
    timer: null,
    timerAt: 0,
    cooldownUntil: 0,
    lastRun: null,
    bootstrapped: false,
    configError: null,
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

/** Pick up messages left in the queue by a previous process shortly after start. */
function bootstrap() {
  const state = runner();
  if (state.bootstrapped) return;
  state.bootstrapped = true;
  const t = setTimeout(() => void scheduleNextRetry(), 3_000);
  t.unref?.();
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

function prepareMessage(input: EnqueueEmailInput, settings: Settings, nowIso: string): EmailMessage {
  const to = (input.to ?? "").trim().toLowerCase();
  const subject = sanitizeHeaderValue(input.subject ?? "").slice(0, 250) || "(no subject)";
  let html = typeof input.html === "string" ? input.html : "";
  let text = typeof input.text === "string" && input.text.trim() ? input.text.replace(/\r\n?/g, "\n") : "";
  if (html.trim() && !/<html[\s>]/i.test(html)) {
    const wrapped = wrapHtmlFragment(brandFromSettings(settings), subject, html, text || htmlToText(html), input.userId ? { preferencesUrl: preferencesUrl() } : undefined);
    html = wrapped.html;
    text = wrapped.text;
  }
  if (!text) text = htmlToText(html);

  const cc = Array.from(new Set((input.cc ?? []).map((a) => a.trim().toLowerCase()).filter((a) => a && a !== to && isSafeAddress(a)))).slice(0, MAX_CC);
  const problems: string[] = [];
  if (!isSafeAddress(to)) problems.push(`Invalid recipient address "${to.slice(0, 120)}".`);
  if (!html.trim() && !text.trim()) problems.push("The message has no content.");
  if (Buffer.byteLength(html, "utf8") + Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) problems.push("The message is larger than 2 MB.");
  const failed = problems.length > 0;
  const id = uid("eml");
  const trackOpens = !failed && !!input.trackOpens && settings.email.trackOpens;
  const trackClicks = !failed && !!input.trackClicks && settings.email.trackClicks;
  if (trackOpens || trackClicks) html = addEmailTracking(html, id, { opens: trackOpens, clicks: trackClicks });
  const trackingId = normalizeTrackingId(input.trackingId);
  return {
    id,
    to,
    toName: input.toName ? sanitizeHeaderValue(input.toName).slice(0, 120) || undefined : undefined,
    cc: cc.length ? cc : undefined,
    userId: input.userId || undefined,
    subject,
    html,
    text,
    category: input.category,
    ...(trackingId ? { trackingId } : {}),
    status: failed ? "failed" : "queued",
    attempts: 0,
    lastError: failed ? problems.join(" ") : undefined,
    nextAttemptAt: failed ? undefined : nowIso,
    createdAt: nowIso,
  };
}

/**
 * Store an email in the outbox and trigger a delivery attempt in the
 * background. Resolves with the stored message (status "queued", or "failed"
 * when the input is invalid). With `deliverNow`, delivery happens before the
 * promise resolves and the final state is returned.
 */
export async function enqueueEmail(input: EnqueueEmailInput, opts: EnqueueOptions = {}): Promise<EmailMessage> {
  bootstrap();
  const settings = await getSettings();
  const message = prepareMessage(input, settings, new Date().toISOString());
  await mutate((db) => {
    supersedeOlderLinks(db.emails, message);
    db.emails.push(message);
  });
  if (message.status === "queued") {
    if (opts.deliverNow) return (await deliverEmailNow(message.id)) ?? message;
    scheduleDelivery();
  }
  return message;
}

/** Store several emails in one write and trigger one delivery run. */
export async function enqueueEmails(inputs: EnqueueEmailInput[]): Promise<EmailMessage[]> {
  if (!inputs.length) return [];
  bootstrap();
  const settings = await getSettings();
  const now = new Date().toISOString();
  const messages = inputs.map((input) => prepareMessage(input, settings, now));
  await mutate((db) => {
    for (const message of messages) supersedeOlderLinks(db.emails, message);
    db.emails.push(...messages);
  });
  if (messages.some((m) => m.status === "queued")) scheduleDelivery();
  return messages;
}

/* ------------------------------------------------------------------ */
/* Secrets at rest                                                     */
/* ------------------------------------------------------------------ */

const SECRET_LINK_RE = /((?:reset-password|verify-email|two-factor)[^"'\s<>?]*\?(?:[^"'\s<>]*?&(?:amp;)?)?token=)[^&"'\s<>]+/gi;
const ANY_TOKEN_RE = /([?&](?:amp;)?token=)[^&"'\s<>]+/gi;

/** Remove one-time tokens from stored bodies once they are no longer needed for retries. */
function scrubSecrets(row: EmailMessage) {
  row.html = row.html.replace(SECRET_LINK_RE, "$1[redacted]");
  row.text = row.text.replace(SECRET_LINK_RE, "$1[redacted]");
}

/** Signature of one-click unsubscribe links (`&t=<43 chars>`). */
const UNSUBSCRIBE_SIG_RE = /([?&](?:amp;)?t=)[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/**
 * For admin views: hide every `token=` value regardless of category, and the
 * signature of unsubscribe links, so staff opening a preview can neither use
 * a member's one-time link nor unsubscribe them. Open pixels and click
 * redirects are removed too, so viewing a message never records an open or
 * a click on the recipient's behalf.
 */
export function redactForView(value: string): string {
  return stripTracking(value).replace(ANY_TOKEN_RE, "$1••••••••").replace(UNSUBSCRIBE_SIG_RE, "$1••••••••");
}

/* ------------------------------------------------------------------ */
/* One-time link lifetime                                              */
/* ------------------------------------------------------------------ */

/** How long the one-time link in each sensitive category stays valid (the auth token TTL). */
const LINK_TTL_MS: Partial<Record<EmailCategory, number>> = {
  password_reset: AUTH_TOKEN_TTL_MS.password_reset,
  email_verification: AUTH_TOKEN_TTL_MS.email_verification,
};

export const LINK_EXPIRED_ERROR = "Link expired before it could be delivered — the one-time link in this email is no longer valid. The member can request a new one.";
const LINK_SUPERSEDED_ERROR = "Not delivered: a newer link was requested for this member, which invalidates this one.";

/** When the one-time link in this email stops working (ms), or null when it has none. */
export function linkExpiresAt(row: Pick<EmailMessage, "category" | "createdAt">): number | null {
  const ttl = LINK_TTL_MS[row.category];
  if (!ttl) return null;
  const created = Date.parse(row.createdAt);
  return Number.isNaN(created) ? 0 : created + ttl;
}

export function isLinkExpired(row: Pick<EmailMessage, "category" | "createdAt">, now: number = Date.now()): boolean {
  const expires = linkExpiresAt(row);
  return expires !== null && expires <= now;
}

function failRow(row: EmailMessage, error: string) {
  row.status = "failed";
  row.nextAttemptAt = undefined;
  row.lastError = error;
  scrubSecrets(row);
}

/**
 * Issuing a new reset/verification link invalidates the member's older one,
 * so older copies still waiting in the queue are failed instead of retried.
 */
function supersedeOlderLinks(rows: EmailMessage[], message: EmailMessage) {
  if (!message.userId || !LINK_TTL_MS[message.category] || message.status !== "queued") return;
  for (const row of rows) {
    if (row.userId === message.userId && row.category === message.category && row.status === "queued") failRow(row, LINK_SUPERSEDED_ERROR);
  }
}

export function isSensitiveCategory(category: EmailCategory): boolean {
  return SENSITIVE_EMAIL_CATEGORIES.includes(category);
}

/* ------------------------------------------------------------------ */
/* Claim / send / finalize                                             */
/* ------------------------------------------------------------------ */

function isDue(e: EmailMessage, now: number): boolean {
  const at = e.nextAttemptAt ? Date.parse(e.nextAttemptAt) : 0;
  if (e.status === "queued") return !e.nextAttemptAt || Number.isNaN(at) || at <= now;
  if (e.status === "sending") return !!e.nextAttemptAt && !Number.isNaN(at) && at <= now;
  return false;
}

/** Atomically move the next due message (or a specific one) to "sending". */
async function claim(sender: SenderIdentity, onlyId?: string): Promise<EmailMessage | null> {
  return mutate((db) => {
    const now = Date.now();
    let candidate: EmailMessage | undefined;
    if (onlyId) {
      candidate = db.emails.find((e) => e.id === onlyId && (e.status === "queued" || (e.status === "sending" && isDue(e, now))));
      if (candidate && isLinkExpired(candidate, now)) {
        failRow(candidate, LINK_EXPIRED_ERROR);
        return null;
      }
    } else {
      let best = "";
      for (const e of db.emails) {
        if (!isDue(e, now)) continue;
        if (isLinkExpired(e, now)) {
          // Never send (or keep a plaintext token for) a link that can no longer work.
          failRow(e, LINK_EXPIRED_ERROR);
          continue;
        }
        const key = e.nextAttemptAt ?? e.createdAt;
        if (!candidate || key < best) {
          candidate = e;
          best = key;
        }
      }
    }
    if (!candidate) return null;
    if (candidate.status === "sending" && candidate.attempts >= MAX_ATTEMPTS) {
      // Abandoned during its last attempt.
      candidate.status = "failed";
      candidate.lastError = candidate.lastError ?? "Delivery was interrupted and the retry limit was reached.";
      candidate.nextAttemptAt = undefined;
      scrubSecrets(candidate);
      return null;
    }
    candidate.status = "sending";
    candidate.attempts += 1;
    candidate.nextAttemptAt = new Date(now + SENDING_LEASE_MS).toISOString();
    candidate.messageId ??= createMessageId(domainOf(sender.address));
    return { ...candidate };
  });
}

type SendOutcome =
  | { ok: true; response: string; rejected: { address: string; message: string }[] }
  | { ok: false; error: string; retryable: boolean; connectionProblem: boolean };

function composeMime(message: EmailMessage, settings: Settings, sender: SenderIdentity, date: Date = new Date()) {
  const headers: Record<string, string> = {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
    "X-LL-Outbox-Id": message.id,
  };
  if (message.userId && !TRANSACTIONAL_EMAIL_CATEGORIES.includes(message.category)) {
    const scope = findUnsubscribeScope(message.html, message.userId) ?? findUnsubscribeScope(message.text, message.userId);
    if (scope) {
      // RFC 8058 one-click: mail clients POST "List-Unsubscribe=One-Click" to this URL.
      headers["List-Unsubscribe"] = `<${oneClickUnsubscribeUrl(message.userId, scope)}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  }
  const built = buildMimeMessage({
    from: { address: sender.address, name: sender.name },
    to: [{ address: message.to, name: message.toName }],
    cc: message.cc?.map((address) => ({ address })),
    replyTo: resolveReplyTo(settings),
    subject: message.subject,
    text: message.text,
    html: message.html.trim() ? message.html : undefined,
    messageId: message.messageId,
    date,
    headers,
  });
  return { built, envelope: { from: sender.address, to: [message.to, ...(message.cc ?? [])] } };
}

/**
 * The headers this message is (or will be) sent with, decoded for display
 * in the admin outbox. Content headers are omitted.
 */
export async function describeEmailHeaders(message: EmailMessage): Promise<[string, string][]> {
  const settings = await getSettings();
  const sender = resolveSender(settings) ?? { address: "(MAIL_FROM not set)", name: settings.email.fromName, source: "default" as const };
  try {
    const date = new Date(message.sentAt ?? message.createdAt);
    const { built } = composeMime(message, settings, sender, Number.isNaN(date.getTime()) ? new Date() : date);
    return built.headers
      .filter(([name]) => !/^(content-type|content-transfer-encoding|mime-version)$/i.test(name))
      .map(([name, value]): [string, string] => {
        if (name === "Message-ID" && !message.messageId) return [name, "Assigned on the first delivery attempt"];
        return [name, decodeWords(value)];
      });
  } catch (error) {
    return [["Error", describeError(error)]];
  }
}

async function sendClaimed(agent: DeliveryAgent, message: EmailMessage, settings: Settings, sender: SenderIdentity): Promise<SendOutcome> {
  let composed: ReturnType<typeof composeMime>;
  try {
    composed = composeMime(message, settings, sender);
  } catch (error) {
    return { ok: false, error: `Could not build the message: ${describeError(error)}`, retryable: false, connectionProblem: false };
  }
  try {
    const receipt = await agent.send(message, composed.built.raw, composed.envelope);
    return { ok: true, response: receipt.response, rejected: receipt.rejected };
  } catch (error) {
    if (error instanceof SmtpError) {
      return { ok: false, error: error.message, retryable: error.transient || error.scope === "connection", connectionProblem: error.scope === "connection" };
    }
    return { ok: false, error: describeError(error), retryable: true, connectionProblem: true };
  }
}

async function finalize(id: string, outcome: SendOutcome): Promise<EmailMessage | null> {
  return mutate((db) => {
    const row = db.emails.find((e) => e.id === id);
    if (!row) return null;
    const now = Date.now();
    if (outcome.ok) {
      row.status = "sent";
      row.sentAt = new Date(now).toISOString();
      row.nextAttemptAt = undefined;
      row.lastError = outcome.rejected.length
        ? `Delivered, but the server refused: ${outcome.rejected.map((r) => `${r.address} (${r.message})`).join("; ")}`.slice(0, 1000)
        : undefined;
      scrubSecrets(row);
    } else if (outcome.retryable && row.attempts < MAX_ATTEMPTS) {
      const nextAt = now + retryDelayMs(row.attempts);
      const expires = linkExpiresAt(row);
      if (expires !== null && nextAt >= expires) {
        failRow(row, `${LINK_EXPIRED_ERROR} Last error: ${outcome.error}`.slice(0, 1000));
      } else {
        row.status = "queued";
        row.nextAttemptAt = new Date(nextAt).toISOString();
        row.lastError = outcome.error;
      }
    } else {
      row.status = "failed";
      row.nextAttemptAt = undefined;
      row.lastError = outcome.error;
      scrubSecrets(row);
    }
    return { ...row };
  });
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

function emptyResult(reason?: DeliveryRunResult["reason"]): DeliveryRunResult {
  return {
    ran: false,
    reason,
    transport: mailEnv.transport,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
  };
}

async function runDelivery(limit: number): Promise<DeliveryRunResult> {
  const started = Date.now();
  const result: DeliveryRunResult = { ...emptyResult(), ran: true, startedAt: new Date(started).toISOString() };
  const settings = await getSettings();
  const sender = resolveSender(settings);
  const state = runner();
  if (!sender) {
    // A configuration error, not a transient failure: pause automatic runs
    // for a long while (admins see the warning) instead of retrying every second.
    if (state.configError !== NO_SENDER_ERROR) console.warn(`[email] delivery paused: ${NO_SENDER_ERROR}`);
    state.configError = NO_SENDER_ERROR;
    state.cooldownUntil = Date.now() + CONFIG_COOLDOWN_MS;
    return { ...result, ran: false, reason: "no_sender", error: NO_SENDER_ERROR };
  }
  if (state.configError) {
    // The configuration works again (a forced run succeeded): resume automatic runs.
    state.configError = null;
    state.cooldownUntil = 0;
  }
  const agent = createDeliveryAgent();
  try {
    while (result.claimed < limit) {
      const message = await claim(sender);
      if (!message) break;
      result.claimed++;
      const outcome = await sendClaimed(agent, message, settings, sender);
      const row = await finalize(message.id, outcome);
      if (row?.status === "sent") result.sent++;
      else if (row?.status === "failed") result.failed++;
      else if (row?.status === "queued") result.retried++;
      if (!outcome.ok && outcome.connectionProblem) {
        result.error = outcome.error;
        runner().cooldownUntil = Date.now() + CONNECTION_COOLDOWN_MS;
        break;
      }
    }
  } finally {
    await agent.close().catch(() => undefined);
    result.durationMs = Date.now() - started;
  }
  if (result.claimed > 0) {
    const summary = `[email] delivery run: ${result.sent} sent, ${result.retried} to retry, ${result.failed} failed (${result.durationMs} ms)`;
    if (result.error) console.warn(`${summary} — ${result.error}`);
    else if (result.transport === "smtp" || result.failed || result.retried) console.info(summary);
  }
  return result;
}

/**
 * Deliver queued messages that are due (new ones and retries whose backoff
 * has elapsed). Only one run is active per process: a concurrent call
 * returns `{ ran: false, reason: "already_running" }` and asks the active
 * run to go again, unless `wait` is set (then it waits and runs after it).
 * After a connection failure, automatic runs pause for a minute unless
 * `force` is set (cron route, admin "Run delivery now").
 */
export async function deliverDueEmails(limit = DEFAULT_RUN_LIMIT, opts: { wait?: boolean; force?: boolean } = {}): Promise<DeliveryRunResult> {
  bootstrap();
  const state = runner();
  if (state.running) {
    if (!opts.wait) {
      state.rerun = true;
      return emptyResult("already_running");
    }
    while (state.running) await state.running.catch(() => undefined);
  }
  if (!opts.force && state.cooldownUntil > Date.now()) {
    scheduleDelivery(state.cooldownUntil - Date.now() + 50);
    return emptyResult("cooldown");
  }
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit) || DEFAULT_RUN_LIMIT));
  const run = runDelivery(safeLimit);
  state.running = run;
  try {
    const result = await run;
    state.lastRun = result;
    return result;
  } catch (error) {
    const failed = { ...emptyResult(), ran: true, error: describeError(error) };
    state.lastRun = failed;
    return failed;
  } finally {
    state.running = null;
    if (state.rerun) {
      state.rerun = false;
      scheduleDelivery(50);
    } else {
      void scheduleNextRetry();
    }
  }
}

/** Fire-and-forget: run the delivery loop soon (coalesces bursts of enqueues). */
export function scheduleDelivery(delayMs = 25): void {
  const state = runner();
  const at = Date.now() + Math.max(0, delayMs);
  if (state.timer && state.timerAt <= at) return;
  if (state.timer) clearTimeout(state.timer);
  state.timerAt = at;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.timerAt = 0;
    deliverDueEmails().catch((error) => console.error("[email] delivery run failed:", describeError(error)));
  }, Math.max(0, delayMs));
  state.timer.unref?.();
}

/** Arm a timer for the earliest scheduled retry (at most 15 minutes ahead; cron covers longer waits). */
async function scheduleNextRetry(): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    const pausedUntil = runner().cooldownUntil;
    let earliest = Infinity;
    for (const e of db.emails) {
      if (e.status !== "queued" && e.status !== "sending") continue;
      const at = e.nextAttemptAt ? Date.parse(e.nextAttemptAt) : now;
      if (!Number.isNaN(at) && at < earliest) earliest = at;
    }
    if (earliest === Infinity) return;
    // Never wake up before a pause (connection or configuration problem) ends.
    const at = Math.max(earliest, pausedUntil);
    scheduleDelivery(Math.min(15 * 60_000, Math.max(1_000, at - now + 250)));
  } catch (error) {
    console.error("[email] could not schedule the next retry:", describeError(error));
  }
}

/**
 * Deliver one message right now (bypasses the queue order). Used for test
 * emails and "Retry now". Returns the final row, or null if it vanished.
 */
export async function deliverEmailNow(id: string): Promise<EmailMessage | null> {
  const settings = await getSettings();
  const sender = resolveSender(settings);
  if (!sender) {
    await mutate((db) => {
      const row = db.emails.find((e) => e.id === id);
      if (row && row.status === "queued") row.lastError = NO_SENDER_ERROR;
    });
    runner().configError = NO_SENDER_ERROR;
    return findById("emails", id);
  }
  const message = await claim(sender, id);
  if (!message) return findById("emails", id);
  const agent = createDeliveryAgent();
  try {
    const outcome = await sendClaimed(agent, message, settings, sender);
    if (!outcome.ok && outcome.connectionProblem) runner().cooldownUntil = Date.now() + CONNECTION_COOLDOWN_MS;
    return await finalize(message.id, outcome);
  } finally {
    await agent.close().catch(() => undefined);
    void scheduleNextRetry();
  }
}

export interface DeliveryState {
  running: boolean;
  lastRun: DeliveryRunResult | null;
  /** Automatic runs paused until (ISO), after a connection failure or a configuration error. */
  pausedUntil: string | null;
  nextRunAt: string | null;
  /** A configuration problem that stops every delivery (e.g. no sender address). */
  configError: string | null;
}

export function getDeliveryState(): DeliveryState {
  const state = runner();
  return {
    running: !!state.running,
    lastRun: state.lastRun,
    pausedUntil: state.cooldownUntil > Date.now() ? new Date(state.cooldownUntil).toISOString() : null,
    nextRunAt: state.timer && state.timerAt ? new Date(state.timerAt).toISOString() : null,
    configError: state.configError,
  };
}

/* ------------------------------------------------------------------ */
/* Admin operations                                                    */
/* ------------------------------------------------------------------ */

export type OutboxCounts = Record<EmailStatus, number> & { total: number };

export async function getOutboxCounts(): Promise<OutboxCounts> {
  bootstrap();
  const db = await getDb();
  const counts: OutboxCounts = { queued: 0, sending: 0, sent: 0, failed: 0, total: db.emails.length };
  for (const e of db.emails) counts[e.status]++;
  return counts;
}

export type OutboxOpResult = { ok: true; message: EmailMessage | null } | { ok: false; error: string };

/** Queue a failed (or waiting) message again and try it immediately. */
export async function retryEmail(id: string): Promise<OutboxOpResult> {
  const prepared = await mutate((db): OutboxOpResult => {
    const row = db.emails.find((e) => e.id === id);
    if (!row) return { ok: false, error: "This email no longer exists." };
    if (row.status === "sent") return { ok: false, error: "This email was already sent. Use Resend to send a new copy." };
    if (row.status === "sending") return { ok: false, error: "This email is being sent right now." };
    if (row.status === "failed" && isSensitiveCategory(row.category)) {
      return { ok: false, error: "One-time links in this email were removed after it failed. Ask the member to request a new link." };
    }
    if (isLinkExpired(row)) {
      failRow(row, LINK_EXPIRED_ERROR);
      return { ok: false, error: "The one-time link in this email has expired, so it was not sent. Ask the member to request a new link." };
    }
    if (row.status === "failed") row.attempts = 0;
    row.status = "queued";
    row.nextAttemptAt = new Date().toISOString();
    return { ok: true, message: { ...row } };
  });
  if (!prepared.ok) return prepared;
  return { ok: true, message: await deliverEmailNow(id) };
}

/** Send a fresh copy of a sent or failed message. */
export async function resendEmail(id: string): Promise<OutboxOpResult> {
  const original = await findById("emails", id);
  if (!original) return { ok: false, error: "This email no longer exists." };
  if (isSensitiveCategory(original.category)) return { ok: false, error: "Password reset and verification emails contain one-time links and can't be resent. Ask the member to request a new link." };
  if (original.status === "queued" || original.status === "sending") return { ok: false, error: "This email hasn't finished sending yet." };
  const now = new Date().toISOString();
  const copy: EmailMessage = {
    id: uid("eml"),
    to: original.to,
    toName: original.toName,
    cc: original.cc,
    userId: original.userId,
    subject: original.subject,
    html: original.html,
    text: original.text,
    category: original.category,
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  };
  await mutate((db) => {
    db.emails.push(copy);
  });
  return { ok: true, message: await deliverEmailNow(copy.id) };
}

export async function deleteEmail(id: string): Promise<OutboxOpResult> {
  return mutate((db): OutboxOpResult => {
    const row = db.emails.find((e) => e.id === id);
    if (!row) return { ok: false, error: "This email no longer exists." };
    if (row.status === "sending") return { ok: false, error: "This email is being sent right now. Try again in a moment." };
    db.emails = db.emails.filter((e) => e.id !== id);
    return { ok: true, message: null };
  });
}

/** Re-queue every failed message (except ones whose one-time links were removed). */
export async function retryAllFailed(): Promise<{ requeued: number; skipped: number }> {
  const counts = await mutate((db) => {
    let requeued = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    for (const row of db.emails) {
      if (row.status !== "failed") continue;
      if (isSensitiveCategory(row.category) || !isSafeAddress(row.to)) {
        skipped++;
        continue;
      }
      row.status = "queued";
      row.attempts = 0;
      row.nextAttemptAt = now;
      requeued++;
    }
    return { requeued, skipped };
  });
  if (counts.requeued) runner().cooldownUntil = 0;
  return counts;
}

/** Delete sent messages older than `days` (keeps queued and failed ones). */
export async function pruneOutbox(days: number): Promise<number> {
  const cutoff = Date.now() - Math.max(1, days) * 86_400_000;
  return mutate((db) => {
    const before = db.emails.length;
    db.emails = db.emails.filter((e) => !(e.status === "sent" && Date.parse(e.sentAt ?? e.createdAt) < cutoff));
    return before - db.emails.length;
  });
}
