import "server-only";
import type { AiCitation, AiConversation, AiMessage, Course, Database, User } from "@/lib/types";
import { canManageCourse } from "@/lib/data/courses";
import { isModerator } from "@/lib/auth/session";
import { withTimestamp } from "./citations";
import { isUnknownAnswer } from "./prompt";
import { orderedLessons } from "./sources";
import { formatTimestamp } from "./text";
import type { ChatMessageView, CitationView, ConversationSummary } from "./types";
import type { UsageRow } from "./usage";
import { isReportReason, REPORT_REASONS } from "./reports";

/**
 * Read models for the AI tutor: the learner's conversations and the
 * instructor review queue. Everything is computed from a database snapshot.
 */

export interface LessonLink {
  href: string;
  title: string;
}

/** Lesson id → learn URL and title for a course ("" → the course page). */
export function lessonLinks(db: Pick<Database, "chapters" | "lessons">, course: Course): Map<string, LessonLink> {
  const map = new Map<string, LessonLink>([["", { href: `/courses/${course.slug}`, title: course.title }]]);
  for (const { lesson, chapterNumber, lessonNumber } of orderedLessons(db, course.id)) {
    map.set(lesson.id, { href: `/courses/${course.slug}/learn/${chapterNumber}-${lessonNumber}`, title: lesson.title });
  }
  return map;
}

export function citationViews(citations: AiCitation[] | undefined, links: Map<string, LessonLink>): CitationView[] {
  return (citations ?? []).map((c, i) => {
    const link = links.get(c.lessonId) ?? links.get("")!;
    return {
      n: i + 1,
      title: c.title,
      detail: c.seconds !== undefined ? `video at ${formatTimestamp(c.seconds)}` : undefined,
      href: withTimestamp(link.href, c.seconds),
      snippet: c.snippet,
      seconds: c.seconds,
    };
  });
}

export function toMessageView(message: AiMessage, links: Map<string, LessonLink>): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    citations: message.role === "assistant" ? citationViews(message.citations, links) : [],
    helpful: message.helpful,
    flagged: message.flagged,
    reviewStatus: message.reviewStatus,
    instructorNote: message.instructorNote,
    unknown: message.role === "assistant" ? isUnknownAnswer(message.content) || undefined : undefined,
  };
}

function sortByCreated(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function conversationMessages(db: Pick<Database, "aiMessages">, conversationId: string): AiMessage[] {
  return db.aiMessages.filter((m) => m.conversationId === conversationId).sort(sortByCreated);
}

export function toConversationSummary(conversation: AiConversation, messageCount: number, links: Map<string, LessonLink>): ConversationSummary {
  const lesson = conversation.lessonId ? links.get(conversation.lessonId) : undefined;
  return {
    id: conversation.id,
    title: conversation.title,
    lessonId: lesson ? conversation.lessonId : undefined,
    lessonTitle: lesson?.title,
    lessonHref: lesson?.href,
    updatedAt: conversation.updatedAt,
    messageCount,
  };
}

/** The viewer's conversations in a course, newest first. */
export function listConversations(db: Database, userId: string, course: Course, limit = 200): ConversationSummary[] {
  const links = lessonLinks(db, course);
  const counts = new Map<string, number>();
  const mine = db.aiConversations.filter((c) => c.userId === userId && c.courseId === course.id);
  const ids = new Set(mine.map((c) => c.id));
  for (const m of db.aiMessages) if (ids.has(m.conversationId)) counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1);
  return mine
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((c) => toConversationSummary(c, counts.get(c.id) ?? 0, links));
}

/** A conversation owned by `userId` with its messages as view models (null when not theirs). */
export function loadOwnConversation(
  db: Database,
  conversationId: string,
  userId: string,
): { conversation: AiConversation; summary: ConversationSummary; course: Course; messages: ChatMessageView[] } | null {
  const conversation = db.aiConversations.find((c) => c.id === conversationId && c.userId === userId);
  if (!conversation) return null;
  const course = db.courses.find((c) => c.id === conversation.courseId);
  if (!course) return null;
  const links = lessonLinks(db, course);
  const messages = conversationMessages(db, conversation.id).map((m) => toMessageView(m, links));
  return { conversation, summary: toConversationSummary(conversation, messages.length, links), course, messages };
}

/* ------------------------------------------------------------------ */
/* Review queue                                                         */
/* ------------------------------------------------------------------ */

/** Courses whose AI conversations the viewer may review (moderators: all). */
export function reviewableCourses(db: Pick<Database, "courses">, viewer: Pick<User, "id" | "roles">): Course[] {
  if (isModerator(viewer)) return [...db.courses];
  return db.courses.filter((c) => canManageCourse(viewer, c));
}

export type ReviewTab = "flagged" | "gaps" | "recent" | "reviewed";
export const REVIEW_TABS: ReviewTab[] = ["flagged", "gaps", "recent", "reviewed"];

export function isReviewTab(value: unknown): value is ReviewTab {
  return typeof value === "string" && (REVIEW_TABS as string[]).includes(value);
}

export interface ReviewFilters {
  tab: ReviewTab;
  courseId?: string;
  /** "up", "down" or "none" (no feedback). */
  feedback?: string;
  /** Free-text search in the question and the answer. */
  q?: string;
  /** Only messages newer than this many days. */
  days?: number;
}

export interface ReviewRow {
  id: string;
  conversationId: string;
  courseId: string;
  courseTitle: string;
  lessonId?: string;
  lessonTitle?: string;
  learner: { id: string; name: string; avatarUrl?: string } | null;
  question: string;
  answer: string;
  createdAt: string;
  helpful?: boolean;
  flagged: boolean;
  unknown: boolean;
  reviewStatus?: AiMessage["reviewStatus"];
  instructorNote?: string;
  tokensIn: number;
  tokensOut: number;
}

function matchesTab(message: AiMessage, unknown: boolean, tab: ReviewTab): boolean {
  const reviewed = message.reviewStatus === "approved" || message.reviewStatus === "corrected";
  switch (tab) {
    case "flagged":
      return !!message.flagged && !reviewed;
    case "gaps":
      return unknown && !reviewed;
    case "reviewed":
      return reviewed;
    default:
      return true;
  }
}

/** Every assistant answer the viewer may review, newest first, with its question. */
export function reviewRows(db: Database, viewer: Pick<User, "id" | "roles">): ReviewRow[] {
  const courses = new Map(reviewableCourses(db, viewer).map((c) => [c.id, c]));
  const conversations = new Map(db.aiConversations.filter((c) => courses.has(c.courseId)).map((c) => [c.id, c]));
  const byConversation = new Map<string, AiMessage[]>();
  for (const m of db.aiMessages) {
    if (!conversations.has(m.conversationId)) continue;
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }
  const users = new Map(db.users.map((u) => [u.id, u]));
  const lessonTitles = new Map(db.lessons.map((l) => [l.id, l.title]));
  const rows: ReviewRow[] = [];
  for (const [conversationId, messages] of byConversation) {
    const conversation = conversations.get(conversationId)!;
    const course = courses.get(conversation.courseId)!;
    const learner = users.get(conversation.userId);
    messages.sort(sortByCreated);
    let lastQuestion = "";
    for (const m of messages) {
      if (m.role === "user") {
        lastQuestion = m.content;
        continue;
      }
      rows.push({
        id: m.id,
        conversationId,
        courseId: course.id,
        courseTitle: course.title,
        lessonId: conversation.lessonId,
        lessonTitle: conversation.lessonId ? lessonTitles.get(conversation.lessonId) : undefined,
        learner: learner ? { id: learner.id, name: learner.name, avatarUrl: learner.avatarUrl } : null,
        question: lastQuestion,
        answer: m.content,
        createdAt: m.createdAt,
        helpful: m.helpful,
        flagged: !!m.flagged,
        unknown: isUnknownAnswer(m.content),
        reviewStatus: m.reviewStatus,
        instructorNote: m.instructorNote,
        tokensIn: m.tokensIn ?? 0,
        tokensOut: m.tokensOut ?? 0,
      });
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function filterReviewRows(rows: ReviewRow[], filters: ReviewFilters, now: number = Date.now()): ReviewRow[] {
  const q = filters.q?.trim().toLowerCase();
  const since = filters.days && filters.days > 0 ? new Date(now - filters.days * 86_400_000).toISOString() : null;
  return rows.filter((row) => {
    if (!matchesTab({ flagged: row.flagged, reviewStatus: row.reviewStatus } as AiMessage, row.unknown, filters.tab)) return false;
    if (filters.courseId && row.courseId !== filters.courseId) return false;
    if (filters.feedback === "up" && row.helpful !== true) return false;
    if (filters.feedback === "down" && row.helpful !== false) return false;
    if (filters.feedback === "none" && row.helpful !== undefined) return false;
    if (since && row.createdAt < since) return false;
    if (q && !row.question.toLowerCase().includes(q) && !row.answer.toLowerCase().includes(q) && !(row.learner?.name.toLowerCase().includes(q) ?? false)) return false;
    return true;
  });
}

export function reviewTabCounts(rows: ReviewRow[]): Record<ReviewTab, number> {
  const counts: Record<ReviewTab, number> = { flagged: 0, gaps: 0, recent: rows.length, reviewed: 0 };
  for (const row of rows) {
    const m = { flagged: row.flagged, reviewStatus: row.reviewStatus } as AiMessage;
    if (matchesTab(m, row.unknown, "flagged")) counts.flagged++;
    if (matchesTab(m, row.unknown, "gaps")) counts.gaps++;
    if (matchesTab(m, row.unknown, "reviewed")) counts.reviewed++;
  }
  return counts;
}

/** Latest "report" reasons per message, from the audit log. */
export function reportReasons(db: Pick<Database, "auditEvents">, messageIds: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of db.auditEvents) {
    if (e.action !== "ai.message.report" || !e.targetId || !messageIds.has(e.targetId)) continue;
    const reason = typeof e.meta?.reason === "string" ? e.meta.reason : "";
    if (reason) out.set(e.targetId, reason);
  }
  return out;
}

/** Course instructors to notify about flagged answers (moderators when the course has none). */
export function reviewRecipients(db: Pick<Database, "users">, course: Course): string[] {
  const instructors = course.instructorIds.filter((id) => db.users.some((u) => u.id === id && u.enabled));
  if (instructors.length) return instructors;
  return db.users.filter((u) => u.enabled && u.roles.some((r) => r === "moderator" || r === "admin")).map((u) => u.id);
}

/** Review filters from the URL (`?tab=&course=&feedback=&q=&days=`). */
export function parseReviewFilters(get: (key: string) => string | undefined): ReviewFilters {
  const tab = get("tab");
  const days = Number(get("days"));
  const feedback = get("feedback");
  return {
    tab: isReviewTab(tab) ? tab : "flagged",
    courseId: get("course") || undefined,
    feedback: feedback === "up" || feedback === "down" || feedback === "none" ? feedback : undefined,
    q: get("q")?.slice(0, 200) || undefined,
    days: [7, 30, 90].includes(days) ? days : undefined,
  };
}

/** CSV rows (header first) of review rows for spreadsheets. */
export function reviewRowsToTable(rows: ReviewRow[]): string[][] {
  const header = ["Time (UTC)", "Course", "Lesson", "Learner", "Question", "Answer", "Feedback", "Flagged", "Unanswered", "Review status", "Instructor note", "Input tokens", "Output tokens"];
  return [
    header,
    ...rows.map((r) => [
      r.createdAt,
      r.courseTitle,
      r.lessonTitle ?? "",
      r.learner?.name ?? "Deleted user",
      r.question,
      r.answer,
      r.helpful === true ? "helpful" : r.helpful === false ? "not helpful" : "",
      r.flagged ? "yes" : "",
      r.unknown ? "yes" : "",
      r.reviewStatus ?? "",
      r.instructorNote ?? "",
      String(r.tokensIn),
      String(r.tokensOut),
    ]),
  ];
}

/** Review rows as input for the usage dashboard. */
export function toUsageRows(rows: ReviewRow[]): UsageRow[] {
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    courseId: r.courseId,
    lessonId: r.lessonId,
    learnerId: r.learner?.id,
    question: r.question,
    createdAt: r.createdAt,
    helpful: r.helpful,
    flagged: r.flagged,
    unknown: r.unknown,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
  }));
}

export interface ReviewMessage extends ChatMessageView {
  /** Why the learner reported this answer, when they did. */
  reportReason?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ReviewConversation {
  conversation: AiConversation;
  course: Course;
  learner: { id: string; name: string; username: string; avatarUrl?: string } | null;
  lessonTitle?: string;
  lessonHref?: string;
  messages: ReviewMessage[];
}

/** A full conversation for the review screen, or null when the viewer may not review it. */
export function loadReviewConversation(db: Database, viewer: Pick<User, "id" | "roles">, conversationId: string): ReviewConversation | null {
  const conversation = db.aiConversations.find((c) => c.id === conversationId);
  if (!conversation) return null;
  const course = db.courses.find((c) => c.id === conversation.courseId);
  if (!course || !canManageCourse(viewer, course)) return null;
  const links = lessonLinks(db, course);
  const stored = conversationMessages(db, conversation.id);
  const reasons = reportReasons(db, new Set(stored.map((m) => m.id)));
  const learner = db.users.find((u) => u.id === conversation.userId);
  const lesson = conversation.lessonId ? links.get(conversation.lessonId) : undefined;
  return {
    conversation,
    course,
    learner: learner ? { id: learner.id, name: learner.name, username: learner.username, avatarUrl: learner.avatarUrl } : null,
    lessonTitle: lesson?.title,
    lessonHref: lesson?.href,
    messages: stored.map((m) => {
      const view: ReviewMessage = toMessageView(m, links);
      const reason = reasons.get(m.id);
      if (reason && isReportReason(reason)) view.reportReason = REPORT_REASONS[reason];
      if (m.tokensIn) view.tokensIn = m.tokensIn;
      if (m.tokensOut) view.tokensOut = m.tokensOut;
      return view;
    }),
  };
}
