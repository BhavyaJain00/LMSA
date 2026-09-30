/**
 * Client-safe view models for the AI tutor. Nothing here carries data about
 * other learners, instructor-only notes or secrets.
 */

export interface CitationView {
  /** 1-based number used in the answer, e.g. [2]. */
  n: number;
  /** Lesson title (or the course title for the overview). */
  title: string;
  /** Where the passage comes from, e.g. "video at 2:15". */
  detail?: string;
  href: string;
  snippet: string;
  seconds?: number;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Excerpts the answer could cite; the chips show the cited ones. */
  citations: CitationView[];
  helpful?: boolean;
  flagged?: boolean;
  reviewStatus?: "pending" | "approved" | "corrected";
  /** Instructor correction or comment. */
  instructorNote?: string;
  /** The tutor said the course doesn't cover the question. */
  unknown?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  /** The lesson the conversation was started from, while it still exists. */
  lessonId?: string;
  lessonTitle?: string;
  lessonHref?: string;
  updatedAt: string;
  messageCount: number;
}

export interface QuotaView {
  /** 0 = unlimited. */
  limit: number;
  remaining: number | null;
  resetsAt: string;
}

export type AiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_configured"
  | "invalid_input"
  | "quota"
  | "rate_limited"
  | "busy"
  | "overloaded"
  | "provider_error";

/** Events of the `/api/ai/chat` SSE stream. */
export type ChatStreamEvent =
  | { type: "start"; conversation: ConversationSummary; userMessage: ChatMessageView; quota: QuotaView }
  | { type: "citations"; citations: CitationView[] }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessageView; quota: QuotaView }
  | { type: "error"; code: AiErrorCode; message: string; retryAfter?: number };

/** Why the tutor can't be used by the current viewer. */
export type AiUnavailableReason = "signin" | "site_disabled" | "no_key" | "course_disabled" | "not_enrolled" | "not_found";
