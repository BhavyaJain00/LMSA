import type { Conversation, DirectMessage, Role } from "@/lib/types";

/**
 * Direct messages — pure rules (no I/O), shared by the server module
 * (`messages.ts`), the actions, the polling route and the client components.
 *
 *  - who may start a conversation with whom (`decideMessaging`);
 *  - message validation (`normalizeMessageBody`), unread counts, read receipts;
 *  - the markdown-lite format of message bodies (`parseMessageBody`): paragraphs,
 *    line breaks, bullet lists, quotes, fenced code, `code`, **bold**, *italic*,
 *    ~~strike~~, [links](https://…) and bare http(s) links. Everything is
 *    rendered as React text, so no HTML from a message ever reaches the page.
 */

declare module "@/lib/types" {
  interface Conversation {
    /** Round 3 comms: who reported the conversation, when and why. */
    reportedBy?: string;
    reportedAt?: string;
    reportReason?: string;
    /** The message the reporter pointed at (optional). */
    reportedMessageId?: string;
    /** A moderator closed the report. */
    reportResolvedAt?: string;
    reportResolvedBy?: string;
    /** Total reports filed on this conversation (a re-report reopens it). */
    reportCount?: number;
  }
  interface DirectMessage {
    /** Round 3 comms: removed by its sender or by a moderator; the body is cleared. */
    removedAt?: string;
    removedBy?: string;
  }
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const MESSAGE_LIMITS = {
  /** Characters per message. */
  bodyMax: 4000,
  subjectMax: 120,
  reportReasonMax: 500,
  /** Messages returned per page of a thread. */
  threadPage: 40,
  /** Conversations returned per page of the inbox. */
  inboxPage: 30,
  /** Characters of the last message shown in the inbox. */
  previewMax: 90,
  /** Polling interval of the inbox and the open thread. */
  pollMs: 10_000,
} as const;

/** Sliding-window rate limits (per sender). */
export const MESSAGE_RATES = {
  /** Messages per minute and per day. */
  perMinute: { limit: 20, windowMs: 60_000 },
  perDay: { limit: 500, windowMs: 24 * 3_600_000 },
  /** New conversations per hour (learners) — staff get the larger limit. */
  newPerHour: { limit: 10, windowMs: 3_600_000 },
  newPerHourStaff: { limit: 60, windowMs: 3_600_000 },
  /** Reports per hour. */
  reportsPerHour: { limit: 5, windowMs: 3_600_000 },
  /** Polling requests per minute (two tabs polling every 10 s stay far below). */
  pollsPerMinute: { limit: 40, windowMs: 60_000 },
} as const;

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export interface MessagingPolicy {
  enabled: boolean;
  studentToStudent: boolean;
}

export interface MessagingMember {
  id: string;
  roles: readonly Role[];
  enabled: boolean;
}

/**
 * Who learns and who teaches what. Keys are `course:<id>` and `batch:<id>`.
 * Build it once per request with `buildMessagingDirectory`.
 */
export interface MessagingDirectory {
  learning: ReadonlyMap<string, ReadonlySet<string>>;
  teaching: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface DirectorySource {
  courses: readonly { id: string; instructorIds: readonly string[]; evaluatorId?: string }[];
  batches: readonly { id: string; instructorIds: readonly string[] }[];
  enrollments: readonly { userId: string; courseId: string }[];
  batchEnrollments: readonly { userId: string; batchId: string }[];
}

function addTo(map: Map<string, Set<string>>, userId: string, key: string): void {
  let set = map.get(userId);
  if (!set) map.set(userId, (set = new Set()));
  set.add(key);
}

export function buildMessagingDirectory(source: DirectorySource): MessagingDirectory {
  const learning = new Map<string, Set<string>>();
  const teaching = new Map<string, Set<string>>();
  for (const e of source.enrollments) addTo(learning, e.userId, `course:${e.courseId}`);
  for (const e of source.batchEnrollments) addTo(learning, e.userId, `batch:${e.batchId}`);
  for (const c of source.courses) {
    for (const id of c.instructorIds) addTo(teaching, id, `course:${c.id}`);
    if (c.evaluatorId) addTo(teaching, c.evaluatorId, `course:${c.id}`);
  }
  for (const b of source.batches) for (const id of b.instructorIds) addTo(teaching, id, `batch:${b.id}`);
  return { learning, teaching };
}

const STAFF_ROLES: readonly Role[] = ["admin", "moderator", "course_creator", "batch_evaluator"];

/** Instructors, evaluators and moderators can message any member. */
export function isMessagingStaff(member: Pick<MessagingMember, "id" | "roles">, directory: MessagingDirectory): boolean {
  return member.roles.some((r) => STAFF_ROLES.includes(r)) || (directory.teaching.get(member.id)?.size ?? 0) > 0;
}

/** Moderators (and admins) review reported conversations. */
export function isMessageModerator(member: Pick<MessagingMember, "roles"> | null | undefined): boolean {
  return !!member && member.roles.some((r) => r === "admin" || r === "moderator");
}

export type MessagingDenyReason = "disabled" | "self" | "unavailable" | "students_off" | "not_allowed";

export type MessagingDecision =
  | { ok: true; via: "staff" | "instructor" | "classmate"; /** Course the two share, for the conversation context. */ courseId?: string }
  | { ok: false; reason: MessagingDenyReason };

export const DENY_MESSAGES: Record<MessagingDenyReason, string> = {
  disabled: "Direct messages are turned off on this site.",
  self: "You can't send a message to yourself.",
  unavailable: "This member can't receive messages right now.",
  students_off: "Learners can only message the instructors of their courses here.",
  not_allowed: "You can message the instructors of courses and batches you're enrolled in.",
};

function intersect(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): string[] {
  if (!a || !b) return [];
  const out: string[] = [];
  for (const key of a) if (b.has(key)) out.push(key);
  return out;
}

function pickCourse(keys: readonly string[], preferredCourseId?: string): string | undefined {
  if (preferredCourseId && keys.includes(`course:${preferredCourseId}`)) return preferredCourseId;
  const first = keys.find((k) => k.startsWith("course:"));
  return first ? first.slice("course:".length) : undefined;
}

/**
 * May `sender` start a conversation with `recipient`?
 *  - messaging must be on, both accounts enabled, and the two must differ;
 *  - instructors (anyone teaching a course or batch, or with a staff role) and
 *    moderators may message any member;
 *  - learners may message the instructors/evaluators of a course or batch they
 *    are enrolled in;
 *  - learners may message other learners only when `studentToStudent` is on,
 *    and only classmates (people sharing a course or batch with them).
 * Replies inside an existing conversation follow `canReply` instead.
 */
export function decideMessaging(
  policy: MessagingPolicy,
  sender: MessagingMember,
  recipient: MessagingMember,
  directory: MessagingDirectory,
  preferredCourseId?: string,
): MessagingDecision {
  if (!policy.enabled) return { ok: false, reason: "disabled" };
  if (sender.id === recipient.id) return { ok: false, reason: "self" };
  if (!sender.enabled || !recipient.enabled) return { ok: false, reason: "unavailable" };
  const teaches = intersect(directory.learning.get(sender.id), directory.teaching.get(recipient.id));
  if (teaches.length) return { ok: true, via: "instructor", courseId: pickCourse(teaches, preferredCourseId) };
  if (isMessagingStaff(sender, directory)) {
    const taught = intersect(directory.teaching.get(sender.id), directory.learning.get(recipient.id));
    return { ok: true, via: "staff", courseId: pickCourse(taught, preferredCourseId) };
  }
  const classmates = intersect(directory.learning.get(sender.id), directory.learning.get(recipient.id));
  if (classmates.length) {
    return policy.studentToStudent ? { ok: true, via: "classmate", courseId: pickCourse(classmates, preferredCourseId) } : { ok: false, reason: "students_off" };
  }
  return { ok: false, reason: "not_allowed" };
}

/**
 * May a participant post in an existing conversation? Anyone in it may reply
 * (a learner can always answer an instructor who wrote first) while messaging
 * is on and at least one other participant still has an enabled account.
 */
export function canReply(
  policy: Pick<MessagingPolicy, "enabled">,
  conversation: Pick<Conversation, "participantIds">,
  sender: MessagingMember,
  isEnabled: (userId: string) => boolean,
): MessagingDecision {
  if (!policy.enabled) return { ok: false, reason: "disabled" };
  if (!sender.enabled || !conversation.participantIds.includes(sender.id)) return { ok: false, reason: "not_allowed" };
  const others = conversation.participantIds.filter((id) => id !== sender.id);
  if (!others.some(isEnabled)) return { ok: false, reason: "unavailable" };
  return { ok: true, via: "staff" };
}

export type ThreadAccess = "participant" | "moderator" | null;

/** Participants read their conversations; moderators read conversations that were reported (open or resolved). */
export function threadAccess(conversation: Pick<Conversation, "participantIds" | "reportedAt">, viewer: Pick<MessagingMember, "id" | "roles">): ThreadAccess {
  if (conversation.participantIds.includes(viewer.id)) return "participant";
  if (conversation.reportedAt && isMessageModerator(viewer)) return "moderator";
  return null;
}

/** The existing one-to-one conversation between two members (the most recent one), if any. */
export function findDirectConversation<T extends Pick<Conversation, "participantIds" | "lastMessageAt">>(conversations: readonly T[], a: string, b: string): T | undefined {
  let found: T | undefined;
  for (const c of conversations) {
    if (c.participantIds.length !== 2 || !c.participantIds.includes(a) || !c.participantIds.includes(b)) continue;
    if (!found || c.lastMessageAt > found.lastMessageAt) found = c;
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

// Control characters other than tab and newline, plus bidi overrides that can disguise text.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export type BodyResult = { ok: true; body: string } | { ok: false; error: string };

/** Clean and validate a message body: normalized newlines, no control characters, at most two blank lines in a row. */
export function normalizeMessageBody(raw: unknown): BodyResult {
  if (typeof raw !== "string") return { ok: false, error: "Write a message first." };
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARS, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (body.length > MESSAGE_LIMITS.bodyMax) return { ok: false, error: `Messages can be up to ${MESSAGE_LIMITS.bodyMax.toLocaleString("en-US")} characters (this one has ${body.length.toLocaleString("en-US")}).` };
  return { ok: true, body };
}

/** One line of plain text (subjects, report reasons), clipped to `max`. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max).trimEnd();
}

/* ------------------------------------------------------------------ */
/* Read state                                                          */
/* ------------------------------------------------------------------ */

type ReadableMessage = Pick<DirectMessage, "senderId" | "readBy" | "removedAt">;

export function isUnreadFor(message: ReadableMessage, userId: string): boolean {
  return message.senderId !== userId && !message.removedAt && !message.readBy.includes(userId);
}

export function countUnread(messages: readonly ReadableMessage[], userId: string): number {
  let n = 0;
  for (const m of messages) if (isUnreadFor(m, userId)) n++;
  return n;
}

/**
 * Read receipt: the id of the viewer's latest message that every other
 * participant has read ("Seen"), or null. Messages are in chronological order.
 */
export function lastSeenOwnMessageId(
  messages: readonly Pick<DirectMessage, "id" | "senderId" | "readBy" | "removedAt">[],
  viewerId: string,
  participantIds: readonly string[],
): string | null {
  const others = participantIds.filter((id) => id !== viewerId);
  if (!others.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderId !== viewerId || m.removedAt) continue;
    if (others.every((id) => m.readBy.includes(id))) return m.id;
  }
  return null;
}

/**
 * Email the recipient about a new message only when it starts a new unread
 * run (they had read everything before it), so a burst of messages sends one
 * email instead of one per message.
 */
export function startsUnreadRun(previous: readonly ReadableMessage[], recipientId: string): boolean {
  return countUnread(previous, recipientId) === 0;
}

/** Inbox preview of a message: markdown stripped, whitespace collapsed, clipped. */
export function messagePreview(body: string, max: number = MESSAGE_LIMITS.previewMax): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/(\*\*|~~|\*|_)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/^\s*(?:[-*]\s+|>\s?)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

export type InboxFilter = "all" | "unread";

export function isInboxFilter(value: unknown): value is InboxFilter {
  return value === "all" || value === "unread";
}

/** Case-insensitive match of a search over the other participants' names/usernames, the subject and the course title. */
export function matchesInboxSearch(haystack: readonly (string | undefined)[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((h) => !!h && h.toLowerCase().includes(needle));
}

/* ------------------------------------------------------------------ */
/* Moderation                                                          */
/* ------------------------------------------------------------------ */

export type ReportStatus = "open" | "resolved";

export function isReportStatus(value: unknown): value is ReportStatus {
  return value === "open" || value === "resolved";
}

export function reportStatus(conversation: Pick<Conversation, "reported" | "reportedAt">): ReportStatus | null {
  if (!conversation.reportedAt) return null;
  return conversation.reported ? "open" : "resolved";
}

export const REPORT_CSV_HEADER = ["Conversation", "Participants", "Course", "Reported by", "Reported at", "Reason", "Reports", "Status", "Resolved by", "Resolved at", "Messages", "Last message at"];

/* ------------------------------------------------------------------ */
/* Markdown-lite                                                       */
/* ------------------------------------------------------------------ */

export type InlineNode =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: InlineNode[] }
  | { t: "link"; href: string; c: InlineNode[] };

export type BlockNode = { t: "p"; c: InlineNode[] } | { t: "quote"; c: InlineNode[] } | { t: "ul"; items: InlineNode[][] } | { t: "pre"; v: string };

/** Links in messages may only point to http(s) and mailto addresses. */
export function safeMessageUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\s\\<>"]/.test(value)) return null;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

const INLINE =
  /`([^`\n]+)`|\[([^\]\n]{1,300})\]\(([^()\s]{1,2000})\)|(https?:\/\/[^\s<>"]+)|\*\*(?=\S)([^\n]*?\S)\*\*|~~(?=\S)([^\n]*?\S)~~|(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g;
const TRAILING_PUNCTUATION = /[.,;:!?)'\]]+$/;
const MAX_DEPTH = 4;

function pushText(out: InlineNode[], text: string): void {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) out.push({ t: "br" });
    if (!line) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += line;
    else out.push({ t: "text", v: line });
  });
}

/** Parse inline markdown-lite into nodes. */
export function parseInline(text: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = [];
  if (depth >= MAX_DEPTH) {
    pushText(out, text);
    return out;
  }
  const re = new RegExp(INLINE.source, "g");
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    let end = start + m[0].length;
    let node: InlineNode | null = null;
    if (m[1] !== undefined) node = { t: "code", v: m[1] };
    else if (m[2] !== undefined) {
      const href = safeMessageUrl(m[3]);
      node = href ? { t: "link", href, c: parseInline(m[2], depth + 1) } : null;
    } else if (m[4] !== undefined) {
      const url = m[4].replace(TRAILING_PUNCTUATION, "");
      const href = safeMessageUrl(url);
      if (href) {
        node = { t: "link", href, c: [{ t: "text", v: url }] };
        end = start + url.length;
        re.lastIndex = end;
      }
    } else if (m[5] !== undefined) node = { t: "strong", c: parseInline(m[5], depth + 1) };
    else if (m[6] !== undefined) node = { t: "del", c: parseInline(m[6], depth + 1) };
    else if (m[7] !== undefined) node = { t: "em", c: parseInline(m[7], depth + 1) };
    else if (m[8] !== undefined) node = { t: "em", c: parseInline(m[8], depth + 1) };
    if (!node) continue;
    pushText(out, text.slice(pos, start));
    out.push(node);
    pos = end;
  }
  pushText(out, text.slice(pos));
  return out;
}

/** Parse a message body into blocks: fenced code, bullet lists, quotes and paragraphs (single newlines become line breaks). */
export function parseMessageBody(body: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const close = lines.findIndex((l, j) => j > i && /^\s*```\s*$/.test(l));
      if (close > i) {
        flushPara();
        blocks.push({ t: "pre", v: lines.slice(i + 1, close).join("\n") });
        i = close;
        continue;
      }
    }
    if (/^\s*[-*]\s+\S/.test(line)) {
      flushPara();
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\s*[-*]\s+\S/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, "")));
        i++;
      }
      i--;
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ t: "quote", c: parseInline(quoted.join("\n")) });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}
