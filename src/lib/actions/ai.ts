"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, AiMessage, Course, Database, Settings, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { getDb, mutate } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { audit } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/services/notifications";
import { aiEnv } from "@/lib/server-env";
import { aiSiteStatus } from "@/lib/ai/access";
import { AiProviderError, pingClaude } from "@/lib/ai/anthropic";
import { courseIndexStats } from "@/lib/ai/course-index";
import { isValidModelId } from "@/lib/ai/models";
import { MAX_CORRECTION_CHARS, MAX_PROMPT_ADDITION_CHARS } from "@/lib/ai/prompt";
import { isReportReason, REPORT_REASONS } from "@/lib/ai/reports";
import { loadOwnConversation, reviewRecipients } from "@/lib/ai/service";
import type { ChatMessageView, ConversationSummary } from "@/lib/ai/types";
import { fd, fdBool, truncate } from "@/lib/utils";

/**
 * Server actions of the AI tutor: site settings, the per-course switch,
 * learner conversation tools (open, delete, feedback, report) and the
 * instructor review queue (approve, correct, reopen).
 */

const MAX_DAILY_LIMIT = 1000;
const ID_RE = /^[\w-]{1,64}$/;

const g = globalThis as unknown as { __llAiActionLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llAiActionLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

function revalidateAi(course?: Pick<Course, "slug"> | null) {
  revalidatePath("/admin/ai", "layout");
  if (course) revalidatePath(`/courses/${course.slug}`, "layout");
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export async function saveAiSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change site settings." };

  const model = fd(formData, "model").trim();
  const rawLimit = fd(formData, "dailyMessageLimit").trim();
  const limit = rawLimit === "" ? 0 : Number(rawLimit);
  const systemPrompt = fd(formData, "systemPrompt").replace(/\r\n?/g, "\n").trim();
  const errors: Record<string, string> = {};
  if (!isValidModelId(model)) errors.model = "Enter a model id such as claude-opus-5-5.";
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_LIMIT) errors.dailyMessageLimit = `Enter a whole number from 0 (unlimited) to ${MAX_DAILY_LIMIT}.`;
  if (systemPrompt.length > MAX_PROMPT_ADDITION_CHARS) errors.systemPrompt = `Keep the extra instructions under ${MAX_PROMPT_ADDITION_CHARS.toLocaleString("en-US")} characters.`;
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const next: Settings["ai"] = {
    enabled: fdBool(formData, "enabled"),
    model,
    dailyMessageLimit: limit,
    systemPrompt: systemPrompt || undefined,
    reviewQueue: fdBool(formData, "reviewQueue"),
  };
  const previous = await mutate((db) => {
    const before = db.settings.ai;
    db.settings.ai = next;
    db.settings.updatedAt = new Date().toISOString();
    return before;
  });
  await audit(user, "settings.ai", { type: "settings", id: "ai" }, {
    enabled: next.enabled,
    model: next.model,
    dailyMessageLimit: next.dailyMessageLimit,
    reviewQueue: next.reviewQueue,
    promptChanged: (previous.systemPrompt ?? "") !== (next.systemPrompt ?? ""),
  });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: next.enabled && !aiEnv.anthropicApiKey ? "Saved. Add ANTHROPIC_API_KEY to turn the tutor on." : "AI tutor settings saved" };
}

export interface ConnectionResult {
  model: string;
  latencyMs: number;
  reply: string;
}

/** Send a tiny request with the configured key to check it works (admins). */
export async function testAiConnectionAction(model: string): Promise<ActionResult<ConnectionResult>> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can test the connection." };
  if (!aiEnv.anthropicApiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set on the server." };
  const id = model.trim();
  if (!isValidModelId(id)) return { ok: false, error: "Enter a valid model id first." };
  const rate = limiter.hit(`ai-test:${user.id}`, { limit: 6, windowMs: 60_000 });
  if (!rate.ok) return { ok: false, error: `Too many tests. Try again in ${Math.ceil(rate.retryAfterMs / 1000)} seconds.` };
  try {
    const result = await pingClaude(aiEnv.anthropicApiKey, id);
    return { ok: true, data: result, message: `Connected to ${result.model} in ${result.latencyMs} ms` };
  } catch (err) {
    if (err instanceof AiProviderError) {
      const hint: Partial<Record<AiProviderError["kind"], string>> = {
        auth: "The API key was rejected. Check ANTHROPIC_API_KEY.",
        permission: "The key's workspace isn't allowed to use this model.",
        billing: "The Anthropic account has a billing problem.",
        not_found: "This model isn't available to your account. Pick another model.",
        rate_limit: "The account is rate limited right now; the key itself works.",
        overloaded: "The API is overloaded right now; the key itself works.",
      };
      return { ok: false, error: `${hint[err.kind] ?? "The request failed."} (${err.status ? `HTTP ${err.status}: ` : ""}${truncate(err.message, 200)})` };
    }
    return { ok: false, error: "The connection test failed unexpectedly." };
  }
}

/* ------------------------------------------------------------------ */
/* Per-course switch                                                    */
/* ------------------------------------------------------------------ */

export interface CourseAiTutorState {
  enabled: boolean;
  siteEnabled: boolean;
  keyConfigured: boolean;
  canConfigureSite: boolean;
  index: { chunks: number; lessons: number; transcripts: number; clarifications: number };
}

async function manageableCourse(courseId: string): Promise<{ user: User; course: Course; db: Database } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to continue." };
  if (!ID_RE.test(courseId)) return { error: "Course not found." };
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { error: "Course not found." };
  if (!canManageCourse(user, course)) return { error: "You can't change this course." };
  return { user, course, db };
}

export async function getCourseAiTutorAction(courseId: string): Promise<ActionResult<CourseAiTutorState>> {
  const loaded = await manageableCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const site = aiSiteStatus(loaded.db.settings);
  return {
    ok: true,
    data: {
      enabled: !!loaded.course.aiTutorEnabled,
      siteEnabled: site.enabled,
      keyConfigured: site.keyConfigured,
      canConfigureSite: isAdmin(loaded.user),
      index: courseIndexStats(loaded.db, loaded.course.id),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Learner tools                                                        */
/* ------------------------------------------------------------------ */

export async function loadConversationAction(conversationId: string): Promise<ActionResult<{ conversation: ConversationSummary; messages: ChatMessageView[] }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  if (!ID_RE.test(conversationId)) return { ok: false, error: "Conversation not found." };
  const db = await getDb();
  const loaded = loadOwnConversation(db, conversationId, user.id);
  if (!loaded) return { ok: false, error: "This conversation no longer exists." };
  return { ok: true, data: { conversation: loaded.summary, messages: loaded.messages } };
}

export async function deleteConversationAction(conversationId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const removed = await mutate((db) => {
    const index = db.aiConversations.findIndex((c) => c.id === conversationId && c.userId === user.id);
    if (index === -1) return false;
    db.aiConversations.splice(index, 1);
    for (let i = db.aiMessages.length - 1; i >= 0; i--) if (db.aiMessages[i]!.conversationId === conversationId) db.aiMessages.splice(i, 1);
    return true;
  });
  if (!removed) return { ok: false, error: "This conversation no longer exists." };
  revalidatePath("/admin/ai", "layout");
  return { ok: true, data: undefined, message: "Conversation deleted" };
}

/** Delete every conversation the user had with the tutor in one course. */
export async function clearCourseConversationsAction(courseId: string): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  if (!ID_RE.test(courseId)) return { ok: false, error: "Course not found." };
  const count = await mutate((db) => {
    const ids = new Set(db.aiConversations.filter((c) => c.userId === user.id && c.courseId === courseId).map((c) => c.id));
    if (!ids.size) return 0;
    db.aiConversations = db.aiConversations.filter((c) => !ids.has(c.id));
    db.aiMessages = db.aiMessages.filter((m) => !ids.has(m.conversationId));
    return ids.size;
  });
  revalidatePath("/admin/ai", "layout");
  return { ok: true, data: { count }, message: count ? `${count === 1 ? "1 conversation" : `${count} conversations`} deleted` : "No conversations to delete" };
}

/** An assistant message in one of the user's own conversations. */
function findOwnAnswer(db: Database, messageId: string, userId: string): { message: AiMessage; course: Course } | null {
  const message = db.aiMessages.find((m) => m.id === messageId && m.role === "assistant");
  if (!message) return null;
  const conversation = db.aiConversations.find((c) => c.id === message.conversationId && c.userId === userId);
  if (!conversation) return null;
  const course = db.courses.find((c) => c.id === conversation.courseId);
  return course ? { message, course } : null;
}

async function notifyReviewers(db: Database, course: Course, message: AiMessage, actor: User, why: string) {
  if (!db.settings.ai.reviewQueue) return;
  await notifyMany(reviewRecipients(db, course).filter((id) => id !== actor.id), {
    type: "system",
    subject: `An AI tutor answer in ${course.title} needs review`,
    message: why,
    link: `/admin/ai/conversations/${message.conversationId}?message=${message.id}#m-${message.id}`,
    dedupeKey: `ai-flag:${message.id}`,
  });
}

export async function rateAnswerAction(messageId: string, helpful: boolean | null): Promise<ActionResult<{ helpful: boolean | null; flagged: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const rate = limiter.hit(`ai-feedback:${user.id}`, { limit: 60, windowMs: 60_000 });
  if (!rate.ok) return { ok: false, error: "Slow down a little and try again." };
  const db = await getDb();
  const found = findOwnAnswer(db, messageId, user.id);
  if (!found) return { ok: false, error: "This answer no longer exists." };
  const reported = db.auditEvents.some((e) => e.action === "ai.message.report" && e.targetId === messageId);
  const queue = db.settings.ai.reviewQueue;
  const result = await mutate((d) => {
    const m = d.aiMessages.find((x) => x.id === messageId);
    if (!m) return null;
    const reviewed = m.reviewStatus === "approved" || m.reviewStatus === "corrected";
    if (helpful === null) delete m.helpful;
    else m.helpful = helpful;
    if (helpful === false) {
      m.flagged = true;
      if (queue && !reviewed) m.reviewStatus = "pending";
    } else if (m.flagged && !reported && !reviewed) {
      // Changing a thumbs-down back takes the answer out of the queue (reports stay).
      delete m.flagged;
      delete m.reviewStatus;
    }
    return { helpful: m.helpful ?? null, flagged: !!m.flagged, newlyFlagged: helpful === false && !found.message.flagged };
  });
  if (!result) return { ok: false, error: "This answer no longer exists." };
  if (result.newlyFlagged) await notifyReviewers(db, found.course, found.message, user, "A learner marked an answer as not helpful.");
  revalidatePath("/admin/ai", "layout");
  return { ok: true, data: { helpful: result.helpful, flagged: result.flagged }, message: helpful === false ? "Thanks — the course team will take a look" : helpful ? "Thanks for the feedback" : "Feedback removed" };
}

export async function reportAnswerAction(messageId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  if (!isReportReason(reason)) return { ok: false, error: "Choose what's wrong with the answer." };
  const rate = limiter.hit(`ai-report:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  if (!rate.ok) return { ok: false, error: "You've sent a lot of reports. Try again later." };
  const db = await getDb();
  const found = findOwnAnswer(db, messageId, user.id);
  if (!found) return { ok: false, error: "This answer no longer exists." };
  const queue = db.settings.ai.reviewQueue;
  await mutate((d) => {
    const m = d.aiMessages.find((x) => x.id === messageId);
    if (!m) return;
    m.flagged = true;
    if (queue) m.reviewStatus = "pending";
  });
  await audit(user, "ai.message.report", { type: "ai_message", id: messageId }, { reason, courseId: found.course.id });
  await notifyReviewers(db, found.course, found.message, user, `Reported by a learner: ${REPORT_REASONS[reason]}.`);
  revalidatePath("/admin/ai", "layout");
  return { ok: true, data: undefined, message: queue ? "Reported — an instructor will review this answer" : "Thanks for reporting this answer" };
}

/* ------------------------------------------------------------------ */
/* Review queue                                                         */
/* ------------------------------------------------------------------ */

/** Assistant messages the user may review, with their conversation and course. */
function reviewableAnswers(db: Database, user: User, ids: string[]) {
  const out: { message: AiMessage; course: Course; learnerId: string }[] = [];
  for (const id of ids) {
    const message = db.aiMessages.find((m) => m.id === id && m.role === "assistant");
    const conversation = message ? db.aiConversations.find((c) => c.id === message.conversationId) : undefined;
    const course = conversation ? db.courses.find((c) => c.id === conversation.courseId) : undefined;
    if (!message || !conversation || !course || !canManageCourse(user, course)) continue;
    out.push({ message, course, learnerId: conversation.userId });
  }
  return out;
}

export async function approveAnswersAction(messageIds: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const ids = [...new Set(messageIds.filter((id) => typeof id === "string" && ID_RE.test(id)))].slice(0, 500);
  if (!ids.length) return { ok: false, error: "Select at least one answer." };
  const db = await getDb();
  const allowed = reviewableAnswers(db, user, ids);
  if (!allowed.length) return { ok: false, error: "You can't review these answers." };
  const allowedIds = new Set(allowed.map((a) => a.message.id));
  await mutate((d) => {
    for (const m of d.aiMessages) {
      if (!allowedIds.has(m.id)) continue;
      m.reviewStatus = "approved";
      delete m.instructorNote;
    }
  });
  await audit(user, "ai.review.approve", { type: "ai_message", id: allowed.length === 1 ? allowed[0]!.message.id : `${allowed.length} answers` }, { count: allowed.length });
  revalidateAi();
  return { ok: true, data: { count: allowed.length }, message: allowed.length === 1 ? "Answer approved" : `${allowed.length} answers approved` };
}

export async function correctAnswerAction(messageId: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const text = note.replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "Write the correction first.", fieldErrors: { note: "Write the correction first." } };
  if (text.length > MAX_CORRECTION_CHARS) return { ok: false, error: `Keep the correction under ${MAX_CORRECTION_CHARS.toLocaleString("en-US")} characters.`, fieldErrors: { note: "Too long." } };
  const db = await getDb();
  const [target] = reviewableAnswers(db, user, [messageId]);
  if (!target) return { ok: false, error: "You can't review this answer." };
  const hadNote = !!target.message.instructorNote;
  await mutate((d) => {
    const m = d.aiMessages.find((x) => x.id === messageId);
    if (!m) return;
    m.reviewStatus = "corrected";
    m.instructorNote = text;
  });
  await audit(user, "ai.review.correct", { type: "ai_message", id: messageId }, { courseId: target.course.id, updated: hadNote });
  if (target.learnerId !== user.id) {
    await notify(target.learnerId, {
      type: "reply",
      fromUserId: user.id,
      subject: `An instructor ${hadNote ? "updated their note on" : "reviewed"} an AI tutor answer in ${target.course.title}`,
      message: truncate(text, 280),
      link: `/courses/${target.course.slug}/ask?c=${target.message.conversationId}`,
      dedupeKey: hadNote ? undefined : `ai-correct:${messageId}`,
    });
  }
  revalidateAi(target.course);
  return { ok: true, data: undefined, message: "Correction saved and shared with the learner" };
}

export async function reopenAnswerAction(messageId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const db = await getDb();
  const [target] = reviewableAnswers(db, user, [messageId]);
  if (!target) return { ok: false, error: "You can't review this answer." };
  await mutate((d) => {
    const m = d.aiMessages.find((x) => x.id === messageId);
    if (!m) return;
    delete m.instructorNote;
    if (m.flagged) m.reviewStatus = "pending";
    else delete m.reviewStatus;
  });
  await audit(user, "ai.review.reopen", { type: "ai_message", id: messageId }, { courseId: target.course.id });
  revalidateAi(target.course);
  return { ok: true, data: undefined, message: "Review cleared" };
}
