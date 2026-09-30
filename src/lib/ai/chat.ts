import "server-only";
import type { AiCitation, AiConversation, AiMessage, Course, Database } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { countQuestionsToday, DailyQuestionLedger, quotaStatus, type QuotaStatus } from "./quota";
import { conversationTitle, MAX_QUESTION_CHARS } from "./prompt";
import type { RetrievedExcerpt } from "./course-index";
import type { QuotaView } from "./types";
import { truncateToTokens } from "./text";

/**
 * Persistence and validation for one AI tutor exchange (used by
 * `POST /api/ai/chat`). The learner's question is stored before the model is
 * called and removed again if no answer could be produced, so failed
 * attempts neither clutter the conversation nor count against the quota.
 */

export interface ChatRequest {
  courseId: string;
  conversationId: string | null;
  lessonId: string | null;
  message: string;
}

const ID_RE = /^[\w-]{1,64}$/;

/** Validate the JSON body of a chat request (pure; exported for tests). */
export function parseChatRequest(raw: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid request." };
  const body = raw as Record<string, unknown>;
  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!ID_RE.test(courseId)) return { ok: false, error: "Missing course." };
  const optionalId = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : null);
  if (body.conversationId !== undefined && body.conversationId !== null && !optionalId(body.conversationId)) return { ok: false, error: "Invalid conversation." };
  if (body.lessonId !== undefined && body.lessonId !== null && !optionalId(body.lessonId)) return { ok: false, error: "Invalid lesson." };
  const message = typeof body.message === "string" ? body.message.replace(/\u0000/g, "").trim() : "";
  if (!message) return { ok: false, error: "Type a question first." };
  if (message.length > MAX_QUESTION_CHARS) return { ok: false, error: `Keep your question under ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters.` };
  return { ok: true, value: { courseId, conversationId: optionalId(body.conversationId), lessonId: optionalId(body.lessonId), message } };
}

const g = globalThis as unknown as { __llAiQuestionLedger?: DailyQuestionLedger };
/** Keeps today's count when a learner deletes conversations (see `DailyQuestionLedger`). */
const ledger: DailyQuestionLedger = (g.__llAiQuestionLedger ??= new DailyQuestionLedger());

/**
 * Today's quota for a learner (course managers are not limited). The limit is
 * per learner across all courses.
 */
export function learnerQuota(db: Pick<Database, "aiConversations" | "aiMessages" | "settings">, userId: string, exempt: boolean, now: Date = new Date()): QuotaStatus {
  if (exempt) return quotaStatus(0, 0, now);
  const ids = new Set(db.aiConversations.filter((c) => c.userId === userId).map((c) => c.id));
  return quotaStatus(ledger.used(userId, countQuestionsToday(db.aiMessages, ids, now), now), db.settings.ai.dailyMessageLimit, now);
}

export function toQuotaView(q: QuotaStatus): QuotaView {
  return { limit: q.limit, remaining: q.remaining, resetsAt: q.resetsAt };
}

/** Citations stored with an answer: one per excerpt, in prompt order. */
export function excerptCitations(excerpts: RetrievedExcerpt[], course: Course): AiCitation[] {
  return excerpts.map(({ chunk, text }) => {
    const title =
      chunk.kind === "clarification"
        ? `Instructor clarification · ${chunk.lessonTitle}`
        : chunk.kind === "overview"
          ? `${course.title} · overview`
          : chunk.lessonTitle;
    const citation: AiCitation = { lessonId: chunk.lessonId, title, snippet: truncateToTokens(text.replace(/\s+/g, " ").trim(), 55) };
    if (chunk.seconds !== undefined) citation.seconds = chunk.seconds;
    return citation;
  });
}

export interface UserTurn {
  conversation: AiConversation;
  userMessage: AiMessage;
  createdConversation: boolean;
}

/**
 * Store the learner's question (creating the conversation when needed).
 * Returns null when the conversation disappeared or isn't theirs any more.
 */
export async function saveUserTurn(input: { userId: string; courseId: string; conversationId: string | null; lessonId: string | null; message: string }): Promise<UserTurn | null> {
  const now = new Date().toISOString();
  const turn = await mutate((db): UserTurn | null => {
    let conversation = input.conversationId ? db.aiConversations.find((c) => c.id === input.conversationId) : undefined;
    if (input.conversationId && (!conversation || conversation.userId !== input.userId || conversation.courseId !== input.courseId)) return null;
    let createdConversation = false;
    if (!conversation) {
      conversation = {
        id: uid("aic"),
        userId: input.userId,
        courseId: input.courseId,
        ...(input.lessonId ? { lessonId: input.lessonId } : {}),
        title: conversationTitle(input.message),
        createdAt: now,
        updatedAt: now,
      };
      db.aiConversations.push(conversation);
      createdConversation = true;
    } else {
      conversation.updatedAt = now;
    }
    const userMessage: AiMessage = { id: uid("aim"), conversationId: conversation.id, role: "user", content: input.message, createdAt: now };
    db.aiMessages.push(userMessage);
    return { conversation: { ...conversation }, userMessage, createdConversation };
  });
  if (turn) ledger.add(input.userId);
  return turn;
}

/** Undo a question that got no answer (and its conversation if it was new and is now empty). */
export async function rollbackUserTurn(turn: UserTurn): Promise<void> {
  const removed = await mutate((db) => {
    const index = db.aiMessages.findIndex((m) => m.id === turn.userMessage.id);
    if (index !== -1) db.aiMessages.splice(index, 1);
    if (turn.createdConversation && !db.aiMessages.some((m) => m.conversationId === turn.conversation.id)) {
      const c = db.aiConversations.findIndex((x) => x.id === turn.conversation.id);
      if (c !== -1) db.aiConversations.splice(c, 1);
    }
    return index !== -1;
  });
  // A question the learner deleted in the meantime stays counted, like any other deleted question.
  if (removed) ledger.remove(turn.conversation.userId);
}

/** Store the tutor's answer. */
export async function saveAssistantTurn(turn: UserTurn, answer: { content: string; citations: AiCitation[]; tokensIn?: number; tokensOut?: number }): Promise<AiMessage> {
  const now = new Date().toISOString();
  const message: AiMessage = {
    id: uid("aim"),
    conversationId: turn.conversation.id,
    role: "assistant",
    content: answer.content,
    citations: answer.citations,
    createdAt: now,
  };
  if (answer.tokensIn) message.tokensIn = answer.tokensIn;
  if (answer.tokensOut) message.tokensOut = answer.tokensOut;
  await mutate((db) => {
    // The learner may have deleted the conversation while the answer was streaming.
    const conversation = db.aiConversations.find((c) => c.id === turn.conversation.id);
    if (!conversation) return;
    db.aiMessages.push(message);
    conversation.updatedAt = now;
  });
  return message;
}
