import "server-only";
import type { Conversation, Database, DirectMessage, Notification, Settings, User } from "@/lib/types";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { enqueueEmails, type EnqueueEmailInput } from "@/lib/email/outbox";
import { getEmailBrand } from "@/lib/email/context";
import { isSafeAddress } from "@/lib/email/mime";
import { resolveEmailPreferences } from "@/lib/email/preferences";
import { preferencesUrl, unsubscribeUrl } from "@/lib/email/signing";
import { emailUrl, renderEmail } from "@/lib/email/templates/layout";
import { notifyModerators } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import {
  DENY_MESSAGES,
  MESSAGE_LIMITS,
  MESSAGE_RATES,
  REPORT_CSV_HEADER,
  buildMessagingDirectory,
  canReply,
  cleanLine,
  countUnread,
  decideMessaging,
  findDirectConversation,
  isMessageModerator,
  isMessagingStaff,
  isUnreadFor,
  lastSeenOwnMessageId,
  matchesInboxSearch,
  messagePreview,
  normalizeMessageBody,
  reportStatus,
  startsUnreadRun,
  threadAccess,
  type InboxFilter,
  type MessagingDecision,
  type MessagingDirectory,
  type MessagingMember,
  type MessagingPolicy,
  type ReportStatus,
  type ThreadAccess,
} from "./messages-core";

/**
 * Direct messages (round 3 comms, item 5): inbox, threads, sending with
 * in-app notifications and email copies, read receipts, polling, reports
 * and moderation. Permission rules live in `messages-core.ts`.
 */

/* ------------------------------------------------------------------ */
/* Views sent to the client                                            */
/* ------------------------------------------------------------------ */

export interface ParticipantView {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  headline?: string;
  /** "Instructor", "Moderator"… — shown next to the name. */
  role?: string;
  /** False once the account was disabled or deleted. */
  active: boolean;
}

export interface ConversationSummary {
  id: string;
  others: ParticipantView[];
  subject?: string;
  courseTitle?: string;
  lastMessageAt: string;
  preview: string;
  previewMine: boolean;
  unread: number;
  report: ReportStatus | null;
}

export interface MessageView {
  id: string;
  senderId: string;
  /** Empty for removed messages. */
  body: string;
  removed: boolean;
  /** "sender" or "moderator" for removed messages. */
  removedByRole?: "sender" | "moderator";
  createdAt: string;
}

export interface ThreadView {
  id: string;
  access: Exclude<ThreadAccess, null>;
  subject?: string;
  course?: { id: string; title: string; slug: string };
  participants: ParticipantView[];
  messages: MessageView[];
  /** More messages exist before the first one returned. */
  hasOlder: boolean;
  seenMessageId: string | null;
  /** Null when the viewer may reply; otherwise why not. */
  replyBlocked: string | null;
  report: {
    status: ReportStatus;
    reportedBy?: ParticipantView;
    reportedAt: string;
    reason?: string;
    messageId?: string;
    count: number;
    resolvedAt?: string;
    resolvedBy?: string;
  } | null;
  /** The viewer reported this conversation themselves (and it is still open). */
  reportedByViewer: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isMessageId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function messagingPolicy(settings: Pick<Settings, "messaging">): MessagingPolicy {
  return { enabled: settings.messaging.enabled, studentToStudent: settings.messaging.studentToStudent };
}

export function directoryOf(db: Database): MessagingDirectory {
  return buildMessagingDirectory(db);
}

function member(user: User): MessagingMember {
  return { id: user.id, roles: user.roles, enabled: user.enabled };
}

function roleLabel(user: User, directory: MessagingDirectory): string | undefined {
  if (user.roles.includes("admin")) return "Admin";
  if (user.roles.includes("moderator")) return "Moderator";
  if ((directory.teaching.get(user.id)?.size ?? 0) > 0 || user.roles.includes("course_creator")) return "Instructor";
  if (user.roles.includes("batch_evaluator")) return "Evaluator";
  return undefined;
}

function participantView(user: User | undefined, id: string, directory: MessagingDirectory): ParticipantView {
  if (!user) return { id, name: "Deleted member", username: "", active: false };
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    headline: user.headline,
    role: roleLabel(user, directory),
    active: user.enabled,
  };
}

function messageView(m: DirectMessage): MessageView {
  if (m.removedAt) return { id: m.id, senderId: m.senderId, body: "", removed: true, removedByRole: m.removedBy === m.senderId ? "sender" : "moderator", createdAt: m.createdAt };
  return { id: m.id, senderId: m.senderId, body: m.body, removed: false, createdAt: m.createdAt };
}

/** Messages per conversation, chronological. */
function messagesByConversation(db: Database, ids: ReadonlySet<string>): Map<string, DirectMessage[]> {
  const map = new Map<string, DirectMessage[]>();
  for (const m of db.directMessages) {
    if (!ids.has(m.conversationId)) continue;
    let list = map.get(m.conversationId);
    if (!list) map.set(m.conversationId, (list = []));
    list.push(m);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return map;
}

export function threadPath(conversationId: string): string {
  return `/messages/${conversationId}`;
}

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __llMessageLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llMessageLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 50_000 }));

function retryText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} seconds`;
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${Math.ceil(minutes / 60)} hours`;
}

/** Check several rules before recording any of them, so a rejected attempt costs nothing. */
function takeRate(rules: { key: string; rule: RateLimitRule; message: string }[]): string | null {
  for (const r of rules) {
    const state = limiter.check(r.key, r.rule);
    if (!state.ok) return `${r.message} Try again in ${retryText(state.retryAfterMs)}.`;
  }
  for (const r of rules) limiter.hit(r.key, r.rule);
  return null;
}

/** Polling guard for the feed route: true when the request may proceed. */
export function allowPoll(userId: string): boolean {
  return limiter.hit(`poll:${userId}`, MESSAGE_RATES.pollsPerMinute).ok;
}

function sendRateError(userId: string, opening: { staff: boolean } | null): string | null {
  const rules: { key: string; rule: RateLimitRule; message: string }[] = [
    { key: `msg-min:${userId}`, rule: MESSAGE_RATES.perMinute, message: "You're sending messages very quickly." },
    { key: `msg-day:${userId}`, rule: MESSAGE_RATES.perDay, message: "You've reached today's message limit." },
  ];
  if (opening) {
    rules.push({
      key: `msg-new:${userId}`,
      rule: opening.staff ? MESSAGE_RATES.newPerHourStaff : MESSAGE_RATES.newPerHour,
      message: "You've started many new conversations this hour.",
    });
  }
  return takeRate(rules);
}

/** Clears every counter (tests). */
export function resetMessageRateLimits(): void {
  limiter.resetPrefix("");
}

/* ------------------------------------------------------------------ */
/* Unread count (navigation badge)                                     */
/* ------------------------------------------------------------------ */

/** Unread direct messages for a member across all conversations (0 while messaging is off). */
export function countUnreadMessages(db: Database, userId: string): number {
  if (!db.settings.messaging.enabled) return 0;
  const ids = new Set(db.conversations.filter((c) => c.participantIds.includes(userId)).map((c) => c.id));
  if (!ids.size) return 0;
  let n = 0;
  for (const m of db.directMessages) if (ids.has(m.conversationId) && isUnreadFor(m, userId)) n++;
  return n;
}

export async function getUnreadMessageCount(userId: string): Promise<number> {
  return countUnreadMessages(await getDb(), userId);
}

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

export interface InboxQuery {
  q?: string;
  filter?: InboxFilter;
  offset?: number;
  limit?: number;
}

export interface InboxPage {
  items: ConversationSummary[];
  /** Conversations matching the query. */
  total: number;
  hasMore: boolean;
  /** Unread messages across all conversations. */
  unreadTotal: number;
}

export function listInbox(db: Database, userId: string, query: InboxQuery = {}): InboxPage {
  const directory = directoryOf(db);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const mine = db.conversations.filter((c) => c.participantIds.includes(userId));
  const byConversation = messagesByConversation(db, new Set(mine.map((c) => c.id)));
  let unreadTotal = 0;
  const rows: ConversationSummary[] = [];
  for (const c of mine) {
    const messages = byConversation.get(c.id) ?? [];
    // A conversation shows up once it has a message (a failed first send leaves nothing behind).
    if (!messages.length) continue;
    const unread = countUnread(messages, userId);
    unreadTotal += unread;
    const others = c.participantIds.filter((id) => id !== userId).map((id) => participantView(users.get(id), id, directory));
    const last = [...messages].reverse().find((m) => !m.removedAt) ?? messages[messages.length - 1];
    rows.push({
      id: c.id,
      others,
      subject: c.subject,
      courseTitle: c.courseId ? courses.get(c.courseId)?.title : undefined,
      lastMessageAt: c.lastMessageAt,
      preview: last.removedAt ? "Message removed" : messagePreview(last.body),
      previewMine: last.senderId === userId,
      unread,
      report: reportStatus(c),
    });
  }
  const q = (query.q ?? "").trim();
  const filtered = rows
    .filter((r) => (query.filter === "unread" ? r.unread > 0 : true))
    .filter((r) => matchesInboxSearch([...r.others.flatMap((o) => [o.name, o.username]), r.subject, r.courseTitle], q))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || a.id.localeCompare(b.id));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? MESSAGE_LIMITS.inboxPage)));
  const items = filtered.slice(offset, offset + limit);
  return { items, total: filtered.length, hasMore: offset + items.length < filtered.length, unreadTotal };
}

/* ------------------------------------------------------------------ */
/* Thread                                                              */
/* ------------------------------------------------------------------ */

export interface ThreadQuery {
  /** Return messages created before this message (older page). */
  beforeId?: string;
  limit?: number;
}

export type ThreadResult = { ok: true; thread: ThreadView } | { ok: false; status: 404 };

export function buildThread(db: Database, viewer: User, conversationId: string, query: ThreadQuery = {}): ThreadResult {
  const conversation = db.conversations.find((c) => c.id === conversationId);
  if (!conversation) return { ok: false, status: 404 };
  const access = threadAccess(conversation, viewer);
  if (!access) return { ok: false, status: 404 };
  const directory = directoryOf(db);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const all = messagesByConversation(db, new Set([conversation.id])).get(conversation.id) ?? [];
  const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? MESSAGE_LIMITS.threadPage)));
  let end = all.length;
  if (query.beforeId) {
    const index = all.findIndex((m) => m.id === query.beforeId);
    end = index >= 0 ? index : 0;
  }
  const start = Math.max(0, end - limit);
  const page = all.slice(start, end);
  const course = conversation.courseId ? db.courses.find((c) => c.id === conversation.courseId) : undefined;
  const policy = messagingPolicy(db.settings);
  let replyBlocked: string | null = null;
  if (access === "moderator") replyBlocked = "You're viewing this reported conversation as a moderator.";
  else {
    const decision = canReply(policy, conversation, member(viewer), (id) => users.get(id)?.enabled === true);
    if (!decision.ok) replyBlocked = decision.reason === "unavailable" ? "The other member's account is no longer active, so you can't reply." : DENY_MESSAGES[decision.reason];
  }
  const status = reportStatus(conversation);
  return {
    ok: true,
    thread: {
      id: conversation.id,
      access,
      subject: conversation.subject,
      course: course ? { id: course.id, title: course.title, slug: course.slug } : undefined,
      participants: conversation.participantIds.map((id) => participantView(users.get(id), id, directory)),
      messages: page.map(messageView),
      hasOlder: start > 0,
      seenMessageId: access === "participant" ? lastSeenOwnMessageId(all, viewer.id, conversation.participantIds) : null,
      replyBlocked,
      report:
        status && conversation.reportedAt
          ? {
              status,
              reportedBy: access === "moderator" && conversation.reportedBy ? participantView(users.get(conversation.reportedBy), conversation.reportedBy, directory) : undefined,
              reportedAt: conversation.reportedAt,
              reason: access === "moderator" ? conversation.reportReason : undefined,
              messageId: access === "moderator" ? conversation.reportedMessageId : undefined,
              count: conversation.reportCount ?? 1,
              resolvedAt: conversation.reportResolvedAt,
              resolvedBy: conversation.reportResolvedBy ? users.get(conversation.reportResolvedBy)?.name : undefined,
            }
          : null,
      reportedByViewer: !!conversation.reported && conversation.reportedBy === viewer.id,
    },
  };
}

export interface ThreadUpdate {
  /** Messages created after `afterId` (all of the last page when the cursor is unknown). */
  messages: MessageView[];
  /** Ids of earlier messages that were removed since (so open threads hide them). */
  removedIds: string[];
  seenMessageId: string | null;
  replyBlocked: string | null;
}

/**
 * Polling: new messages after a cursor, removals among the messages the
 * client already shows, and the read receipt. Marks the thread read for a
 * participant who has it open (`markRead`).
 */
export async function pollThread(viewer: User, conversationId: string, afterId: string | null, knownIds: readonly string[], markRead: boolean): Promise<ThreadUpdate | null> {
  if (markRead) await markConversationRead(viewer.id, conversationId);
  const db = await getDb();
  const result = buildThread(db, viewer, conversationId, { limit: 200 });
  if (!result.ok) return null;
  const all = (messagesByConversation(db, new Set([conversationId])).get(conversationId) ?? []).map(messageView);
  let fresh = all;
  if (afterId) {
    const index = all.findIndex((m) => m.id === afterId);
    fresh = index >= 0 ? all.slice(index + 1) : all.slice(-MESSAGE_LIMITS.threadPage);
  }
  const known = new Set(knownIds);
  const removedIds = all.filter((m) => m.removed && known.has(m.id)).map((m) => m.id);
  return { messages: fresh.slice(-200), removedIds, seenMessageId: result.thread.seenMessageId, replyBlocked: result.thread.replyBlocked };
}

/** Mark every message of a conversation read for a participant, plus the matching notifications. Returns the number of messages marked. */
export async function markConversationRead(userId: string, conversationId: string): Promise<number> {
  const db = await getDb();
  const conversation = db.conversations.find((c) => c.id === conversationId);
  if (!conversation?.participantIds.includes(userId)) return 0;
  const link = threadPath(conversationId);
  const pending = db.directMessages.some((m) => m.conversationId === conversationId && isUnreadFor(m, userId)) || db.notifications.some((n) => n.userId === userId && !n.read && n.link === link);
  if (!pending) return 0;
  return mutate((d) => {
    let n = 0;
    for (const m of d.directMessages) {
      if (m.conversationId === conversationId && isUnreadFor(m, userId)) {
        m.readBy.push(userId);
        n++;
      }
    }
    for (const notification of d.notifications) if (notification.userId === userId && notification.link === link) notification.read = true;
    return n;
  });
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export type SendResult = { ok: true; conversationId: string; message: MessageView; created: boolean } | { ok: false; error: string };

interface Delivery {
  conversationId: string;
  message: DirectMessage;
  sender: User;
  /** Recipients whose unread run starts with this message (emailed). */
  emailTo: string[];
}

/** In-app notification for a recipient: one unread notification per conversation, refreshed with each new message. */
function upsertNotification(db: Database, recipientId: string, sender: User, conversationId: string, preview: string, now: string): void {
  const link = threadPath(conversationId);
  const existing = db.notifications.find((n) => n.userId === recipientId && !n.read && n.link === link);
  const subject = `New message from ${sender.name}`;
  if (existing) {
    existing.subject = subject;
    existing.message = preview;
    existing.fromUserId = sender.id;
    existing.createdAt = now;
    return;
  }
  const notification: Notification = { id: uid("ntf"), userId: recipientId, fromUserId: sender.id, type: "system", subject, message: preview, link, read: false, createdAt: now };
  db.notifications.push(notification);
}

function appendMessage(db: Database, conversation: Conversation, sender: User, body: string, now: string): Delivery {
  const previous = db.directMessages.filter((m) => m.conversationId === conversation.id);
  const message: DirectMessage = { id: uid("dm"), conversationId: conversation.id, senderId: sender.id, body, readBy: [sender.id], createdAt: now };
  db.directMessages.push(message);
  conversation.lastMessageAt = now;
  // Writing in a conversation means the sender has seen everything before it.
  for (const m of previous) if (isUnreadFor(m, sender.id)) m.readBy.push(sender.id);
  const preview = messagePreview(body, 140);
  const emailTo: string[] = [];
  for (const recipientId of conversation.participantIds) {
    if (recipientId === sender.id) continue;
    const recipient = db.users.find((u) => u.id === recipientId);
    if (!recipient?.enabled) continue;
    if (startsUnreadRun(previous, recipientId)) emailTo.push(recipientId);
    upsertNotification(db, recipientId, sender, conversation.id, preview, now);
  }
  return { conversationId: conversation.id, message, sender, emailTo };
}

/** Email copies: Settings → Email must be on and the recipient must allow discussion emails. Never throws. */
async function emailRecipients(delivery: Delivery): Promise<void> {
  if (!delivery.emailTo.length) return;
  try {
    const db = await getDb();
    if (!db.settings.email.enabled) return;
    const brand = await getEmailBrand();
    const url = emailUrl(brand, threadPath(delivery.conversationId)) ?? threadPath(delivery.conversationId);
    const inputs: EnqueueEmailInput[] = [];
    for (const id of delivery.emailTo) {
      const user = db.users.find((u) => u.id === id);
      if (!user?.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).discussions) continue;
      const preview = messagePreview(delivery.message.body, 600);
      const rendered = renderEmail(brand, `${delivery.sender.name} sent you a message`, {
        preheader: messagePreview(delivery.message.body, 140),
        eyebrow: "Direct message",
        heading: `New message from ${delivery.sender.name}`,
        greeting: `Hi ${user.name.split(" ")[0] || user.name},`,
        blocks: [
          { type: "quote", text: preview, cite: delivery.sender.name },
          { type: "button", label: "Reply", url },
          { type: "muted", text: "Further messages in this conversation won't be emailed until you've read it." },
        ],
        footer: {
          reason: `You're receiving this because someone sent you a direct message on ${brand.name}.`,
          preferencesUrl: preferencesUrl(),
          unsubscribeUrl: unsubscribeUrl(user.id, "discussions"),
          unsubscribeLabel: "Unsubscribe from discussion and message emails",
        },
      });
      inputs.push({ to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "notification" });
    }
    if (inputs.length) await enqueueEmails(inputs);
  } catch (err) {
    console.error("[messages] email copy failed", err instanceof Error ? err.message : err);
  }
}

/** Reply in an existing conversation. */
export async function sendMessage(sender: User, conversationId: string, rawBody: unknown): Promise<SendResult> {
  const parsed = normalizeMessageBody(rawBody);
  if (!parsed.ok) return parsed;
  if (!isMessageId(conversationId)) return { ok: false, error: "This conversation doesn't exist." };
  const settings = await getSettings();
  const policy = messagingPolicy(settings);
  const db = await getDb();
  const conversation = db.conversations.find((c) => c.id === conversationId);
  if (!conversation || !conversation.participantIds.includes(sender.id)) return { ok: false, error: "This conversation doesn't exist." };
  const check = canReply(policy, conversation, member(sender), (id) => db.users.some((u) => u.id === id && u.enabled));
  if (!check.ok) return { ok: false, error: check.reason === "unavailable" ? "The other member's account is no longer active." : DENY_MESSAGES[check.reason] };
  const rate = sendRateError(sender.id, null);
  if (rate) return { ok: false, error: rate };
  const now = new Date().toISOString();
  const delivery = await mutate((d) => {
    const c = d.conversations.find((x) => x.id === conversationId);
    return c ? appendMessage(d, c, sender, parsed.body, now) : null;
  });
  if (!delivery) return { ok: false, error: "This conversation doesn't exist." };
  await emailRecipients(delivery);
  return { ok: true, conversationId, message: messageView(delivery.message), created: false };
}

export interface StartInput {
  recipientId: string;
  body: unknown;
  courseId?: string;
  subject?: unknown;
}

/** Whether `sender` may start a conversation with `recipient` (and in which course context). */
export function decideFor(db: Database, sender: User, recipient: User, courseId?: string): MessagingDecision {
  return decideMessaging(messagingPolicy(db.settings), member(sender), member(recipient), directoryOf(db), courseId);
}

/**
 * Start (or continue) a one-to-one conversation. When the two already have a
 * conversation, the message is added to it instead of opening a second one.
 */
export async function startConversation(sender: User, input: StartInput): Promise<SendResult> {
  const parsed = normalizeMessageBody(input.body);
  if (!parsed.ok) return parsed;
  const db = await getDb();
  const recipient = isMessageId(input.recipientId) ? db.users.find((u) => u.id === input.recipientId) : undefined;
  if (!recipient) return { ok: false, error: "This member doesn't exist." };
  const existing = findDirectConversation(db.conversations, sender.id, recipient.id);
  if (existing) return sendMessage(sender, existing.id, parsed.body);
  const decision = decideFor(db, sender, recipient, isMessageId(input.courseId) ? input.courseId : undefined);
  if (!decision.ok) return { ok: false, error: DENY_MESSAGES[decision.reason] };
  const rate = sendRateError(sender.id, { staff: isMessagingStaff(member(sender), directoryOf(db)) });
  if (rate) return { ok: false, error: rate };
  const subject = cleanLine(input.subject, MESSAGE_LIMITS.subjectMax) || undefined;
  const now = new Date().toISOString();
  const result = await mutate((d) => {
    // Re-check inside the write: a parallel send may have created the conversation meanwhile.
    const again = findDirectConversation(d.conversations, sender.id, recipient.id);
    const conversation: Conversation = again ?? { id: uid("cnv"), participantIds: [sender.id, recipient.id], courseId: decision.courseId, subject, lastMessageAt: now, createdAt: now };
    if (!again) d.conversations.push(conversation);
    return { delivery: appendMessage(d, conversation, sender, parsed.body, now), created: !again };
  });
  await emailRecipients(result.delivery);
  return { ok: true, conversationId: result.delivery.conversationId, message: messageView(result.delivery.message), created: result.created };
}

/* ------------------------------------------------------------------ */
/* Recipients                                                          */
/* ------------------------------------------------------------------ */

export interface RecipientOption extends ParticipantView {
  /** Course the two share (context of a new conversation). */
  courseId?: string;
  courseTitle?: string;
  /** An existing conversation with this member. */
  conversationId?: string;
}

function recipientOption(db: Database, directory: MessagingDirectory, sender: User, user: User, decision: Extract<MessagingDecision, { ok: true }>): RecipientOption {
  const existing = findDirectConversation(db.conversations, sender.id, user.id);
  return {
    ...participantView(user, user.id, directory),
    courseId: decision.courseId,
    courseTitle: decision.courseId ? db.courses.find((c) => c.id === decision.courseId)?.title : undefined,
    conversationId: existing?.id,
  };
}

/**
 * People the sender may message whose name, username or email matches `q`.
 * Without a query: the instructors of the sender's courses and batches.
 */
export function searchRecipients(db: Database, sender: User, q: string, limit = 20): RecipientOption[] {
  const policy = messagingPolicy(db.settings);
  if (!policy.enabled) return [];
  const directory = directoryOf(db);
  const needle = q.trim().toLowerCase();
  const learning = directory.learning.get(sender.id);
  const out: RecipientOption[] = [];
  for (const user of db.users) {
    if (out.length >= limit) break;
    if (user.id === sender.id || !user.enabled) continue;
    if (needle) {
      const emailMatch = isMessagingStaff(member(sender), directory) && user.email.toLowerCase() === needle;
      if (!emailMatch && !user.name.toLowerCase().includes(needle) && !user.username.toLowerCase().includes(needle)) continue;
    } else {
      const teaches = directory.teaching.get(user.id);
      if (!learning || !teaches || ![...learning].some((k) => teaches.has(k))) continue;
    }
    const decision = decideMessaging(policy, member(sender), member(user), directory);
    if (decision.ok) out.push(recipientOption(db, directory, sender, user, decision));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type RecipientLookup = { ok: true; recipient: RecipientOption } | { ok: false; error: string; recipient?: ParticipantView };

/** Resolve `?to=<username or id>` for the new-message page. */
export function lookupRecipient(db: Database, sender: User, to: string, courseId?: string): RecipientLookup {
  const key = to.trim().replace(/^@/, "");
  const user = db.users.find((u) => u.username === key || u.id === key);
  if (!user) return { ok: false, error: "We couldn't find this member." };
  const directory = directoryOf(db);
  const existing = findDirectConversation(db.conversations, sender.id, user.id);
  if (existing && user.id !== sender.id) return { ok: true, recipient: { ...participantView(user, user.id, directory), conversationId: existing.id } };
  const decision = decideFor(db, sender, user, courseId);
  if (!decision.ok) return { ok: false, error: DENY_MESSAGES[decision.reason], recipient: participantView(user, user.id, directory) };
  return { ok: true, recipient: recipientOption(db, directory, sender, user, decision) };
}

/** For "Message instructor" buttons: where the button should lead, or null when the viewer can't message this member. */
export function messageLinkFor(db: Database, viewer: User | null, recipientId: string, courseId?: string): string | null {
  if (!viewer || viewer.id === recipientId || !db.settings.messaging.enabled) return null;
  const recipient = db.users.find((u) => u.id === recipientId);
  if (!recipient) return null;
  const existing = findDirectConversation(db.conversations, viewer.id, recipient.id);
  if (existing) return threadPath(existing.id);
  if (!decideFor(db, viewer, recipient, courseId).ok) return null;
  const params = new URLSearchParams({ to: recipient.username });
  if (courseId) params.set("course", courseId);
  return `/messages/new?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Removing messages                                                   */
/* ------------------------------------------------------------------ */

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Senders remove their own messages; moderators remove messages in reported conversations. */
export async function removeMessage(actor: User, messageId: string): Promise<SimpleResult & { conversationId?: string; byModerator?: boolean }> {
  if (!isMessageId(messageId)) return { ok: false, error: "This message doesn't exist." };
  const db = await getDb();
  const message = db.directMessages.find((m) => m.id === messageId);
  const conversation = message ? db.conversations.find((c) => c.id === message.conversationId) : undefined;
  if (!message || !conversation) return { ok: false, error: "This message doesn't exist." };
  const own = message.senderId === actor.id;
  const moderating = !own && threadAccess(conversation, actor) === "moderator";
  if (!own && !moderating) return { ok: false, error: "You can only remove your own messages." };
  if (message.removedAt) return { ok: true, conversationId: conversation.id, byModerator: moderating };
  const now = new Date().toISOString();
  await mutate((d) => {
    const m = d.directMessages.find((x) => x.id === messageId);
    if (!m || m.removedAt) return;
    m.body = "";
    m.removedAt = now;
    m.removedBy = actor.id;
    // A removed message no longer counts as news: refresh notifications that only pointed at it.
    const link = threadPath(m.conversationId);
    for (const n of d.notifications) {
      if (n.link !== link || n.read) continue;
      const stillUnread = d.directMessages.some((x) => x.conversationId === m.conversationId && isUnreadFor(x, n.userId));
      if (!stillUnread) n.read = true;
    }
  });
  return { ok: true, conversationId: conversation.id, byModerator: moderating };
}

/* ------------------------------------------------------------------ */
/* Reports and moderation                                              */
/* ------------------------------------------------------------------ */

/** A participant reports the conversation (optionally pointing at one message). Moderators are notified once per open report. */
export async function reportConversation(reporter: User, conversationId: string, rawReason: unknown, messageId?: string): Promise<SimpleResult> {
  if (!isMessageId(conversationId)) return { ok: false, error: "This conversation doesn't exist." };
  const reason = cleanLine(rawReason, MESSAGE_LIMITS.reportReasonMax);
  if (reason.length < 3) return { ok: false, error: "Tell the moderators briefly what's wrong." };
  const db = await getDb();
  const conversation = db.conversations.find((c) => c.id === conversationId);
  if (!conversation?.participantIds.includes(reporter.id)) return { ok: false, error: "This conversation doesn't exist." };
  const pointed = messageId && isMessageId(messageId) ? db.directMessages.find((m) => m.id === messageId && m.conversationId === conversationId && m.senderId !== reporter.id) : undefined;
  const rate = takeRate([{ key: `report:${reporter.id}`, rule: MESSAGE_RATES.reportsPerHour, message: "You've sent several reports this hour." }]);
  if (rate) return { ok: false, error: rate };
  const now = new Date().toISOString();
  const wasOpen = await mutate((d) => {
    const c = d.conversations.find((x) => x.id === conversationId);
    if (!c) return true;
    const open = !!c.reported;
    c.reported = true;
    c.reportedBy = reporter.id;
    c.reportedAt = now;
    c.reportReason = reason;
    c.reportedMessageId = pointed?.id;
    c.reportCount = (c.reportCount ?? 0) + 1;
    c.reportResolvedAt = undefined;
    c.reportResolvedBy = undefined;
    return open;
  });
  if (!wasOpen) {
    await notifyModerators({
      type: "system",
      subject: "A conversation was reported",
      message: `${reporter.name}: ${reason}`,
      link: threadPath(conversationId),
      fromUserId: reporter.id,
    });
  }
  return { ok: true };
}

/** Close an open report (the conversation stays visible to moderators as resolved). */
export async function resolveReport(moderator: User, conversationId: string): Promise<SimpleResult> {
  if (!isMessageModerator(moderator)) return { ok: false, error: "Only moderators can review reports." };
  if (!isMessageId(conversationId)) return { ok: false, error: "This conversation doesn't exist." };
  const now = new Date().toISOString();
  const found = await mutate((d) => {
    const c = d.conversations.find((x) => x.id === conversationId);
    if (!c?.reportedAt) return false;
    c.reported = false;
    c.reportResolvedAt = now;
    c.reportResolvedBy = moderator.id;
    return true;
  });
  return found ? { ok: true } : { ok: false, error: "This report doesn't exist." };
}

export interface ReportRow {
  id: string;
  participants: ParticipantView[];
  courseTitle?: string;
  reportedBy?: ParticipantView;
  reportedAt: string;
  reason?: string;
  count: number;
  status: ReportStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface ReportQuery {
  status?: ReportStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ReportPage {
  rows: ReportRow[];
  total: number;
  page: number;
  pageCount: number;
  counts: Record<ReportStatus, number>;
}

function reportRows(db: Database): ReportRow[] {
  const directory = directoryOf(db);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const reported = db.conversations.filter((c) => c.reportedAt);
  const counts = new Map<string, number>();
  const ids = new Set(reported.map((c) => c.id));
  for (const m of db.directMessages) if (ids.has(m.conversationId)) counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1);
  return reported.map((c) => ({
    id: c.id,
    participants: c.participantIds.map((id) => participantView(users.get(id), id, directory)),
    courseTitle: c.courseId ? courses.get(c.courseId)?.title : undefined,
    reportedBy: c.reportedBy ? participantView(users.get(c.reportedBy), c.reportedBy, directory) : undefined,
    reportedAt: c.reportedAt as string,
    reason: c.reportReason,
    count: c.reportCount ?? 1,
    status: c.reported ? "open" : "resolved",
    resolvedBy: c.reportResolvedBy ? users.get(c.reportResolvedBy)?.name : undefined,
    resolvedAt: c.reportResolvedAt,
    messageCount: counts.get(c.id) ?? 0,
    lastMessageAt: c.lastMessageAt,
  }));
}

export function listReports(db: Database, query: ReportQuery = {}): ReportPage {
  const all = reportRows(db);
  const counts: Record<ReportStatus, number> = { open: 0, resolved: 0 };
  for (const r of all) counts[r.status]++;
  const status = query.status ?? "open";
  const q = (query.q ?? "").trim();
  const filtered = all
    .filter((r) => r.status === status)
    .filter((r) => matchesInboxSearch([...r.participants.flatMap((p) => [p.name, p.username]), r.reason, r.courseTitle], q))
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(query.page ?? 1)));
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageCount, counts };
}

/** CSV rows (header first) of every report, newest first. */
export function reportCsvRows(db: Database): string[][] {
  const rows = reportRows(db).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  return [
    REPORT_CSV_HEADER,
    ...rows.map((r) => [
      r.id,
      r.participants.map((p) => (p.username ? `${p.name} (@${p.username})` : p.name)).join("; "),
      r.courseTitle ?? "",
      r.reportedBy?.name ?? "",
      r.reportedAt,
      r.reason ?? "",
      String(r.count),
      r.status,
      r.resolvedBy ?? "",
      r.resolvedAt ?? "",
      String(r.messageCount),
      r.lastMessageAt,
    ]),
  ];
}

/** Open reports (moderation badge and overview). */
export function countOpenReports(db: Database): number {
  return db.conversations.filter((c) => c.reported).length;
}
