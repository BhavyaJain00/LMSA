"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fdBool } from "@/lib/utils";
import { MESSAGE_LIMITS, isInboxFilter, isMessageModerator } from "@/lib/comms/messages-core";
import {
  buildThread,
  isMessageId,
  listInbox,
  removeMessage,
  reportConversation,
  resolveReport,
  searchRecipients,
  sendMessage,
  startConversation,
  type InboxPage,
  type MessageView,
  type RecipientOption,
} from "@/lib/comms/messages";

/**
 * Direct message actions (round 3 comms): sending, starting conversations,
 * read state, paging, recipient search, reports, moderation and the messaging
 * settings. Every action re-checks the caller; permissions and rate limits
 * are enforced in `@/lib/comms/messages`.
 */

const SIGN_IN = "Sign in to use messages.";

async function member(): Promise<User | null> {
  const user = await getCurrentUser();
  return user?.enabled ? user : null;
}

function failure(scope: string, error: unknown): { ok: false; error: string } {
  console.error(`[messages] ${scope} failed:`, error instanceof Error ? error.message : String(error));
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Reply in a conversation. */
export async function sendMessageAction(conversationId: string, body: string): Promise<ActionResult<{ message: MessageView }>> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  try {
    const result = await sendMessage(user, conversationId, body);
    return result.ok ? { ok: true, data: { message: result.message } } : result;
  } catch (error) {
    return failure("send", error);
  }
}

/** Start a conversation (or continue the existing one with this member). */
export async function startConversationAction(input: { recipientId: string; body: string; courseId?: string; subject?: string }): Promise<ActionResult<{ conversationId: string }>> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  if (!input || typeof input !== "object") return { ok: false, error: "Choose who to message." };
  try {
    const result = await startConversation(user, { recipientId: String(input.recipientId ?? ""), body: input.body, courseId: input.courseId, subject: input.subject });
    return result.ok ? { ok: true, data: { conversationId: result.conversationId }, message: "Message sent" } : result;
  } catch (error) {
    return failure("start", error);
  }
}

/** An older page of a thread (before the first message the client shows). */
export async function loadOlderMessagesAction(conversationId: string, beforeId: string): Promise<ActionResult<{ messages: MessageView[]; hasOlder: boolean }>> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  if (!isMessageId(conversationId) || !isMessageId(beforeId)) return { ok: false, error: "This conversation doesn't exist." };
  const result = buildThread(await getDb(), user, conversationId, { beforeId });
  if (!result.ok) return { ok: false, error: "This conversation doesn't exist." };
  return { ok: true, data: { messages: result.thread.messages, hasOlder: result.thread.hasOlder } };
}

/** Inbox page for search, the unread filter and "Load more". */
export async function loadInboxAction(query: { q?: string; filter?: string; offset?: number }): Promise<ActionResult<InboxPage>> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  const db = await getDb();
  if (!db.settings.messaging.enabled) return { ok: false, error: "Direct messages are turned off on this site." };
  const q = typeof query?.q === "string" ? query.q.slice(0, 100) : "";
  const filter = isInboxFilter(query?.filter) ? query.filter : "all";
  const offset = Number.isFinite(query?.offset) ? Number(query.offset) : 0;
  return { ok: true, data: listInbox(db, user.id, { q, filter, offset, limit: MESSAGE_LIMITS.inboxPage }) };
}

/** People the caller may message, matching a name, username (or, for staff, an exact email). */
export async function searchRecipientsAction(q: string): Promise<ActionResult<RecipientOption[]>> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  if (query && query.length < 2) return { ok: true, data: [] };
  return { ok: true, data: searchRecipients(await getDb(), user, query, 20) };
}

export async function reportConversationAction(conversationId: string, reason: string, messageId?: string): Promise<ActionResult> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  try {
    const result = await reportConversation(user, conversationId, reason, messageId);
    if (!result.ok) return result;
    await audit(user, "message.report", { type: "conversation", id: conversationId }, messageId ? { messageId } : undefined);
    revalidatePath("/messages/moderation");
    return { ok: true, data: undefined, message: "Thanks — the moderators will take a look." };
  } catch (error) {
    return failure("report", error);
  }
}

export async function resolveReportAction(conversationId: string): Promise<ActionResult> {
  const user = await member();
  if (!user || !isMessageModerator(user)) return { ok: false, error: "Only moderators can review reports." };
  const result = await resolveReport(user, conversationId);
  if (!result.ok) return result;
  await audit(user, "message.report_resolve", { type: "conversation", id: conversationId });
  revalidatePath("/messages", "layout");
  return { ok: true, data: undefined, message: "Report resolved" };
}

/** Remove one of your messages, or (moderators) a message in a reported conversation. */
export async function removeMessageAction(messageId: string): Promise<ActionResult> {
  const user = await member();
  if (!user) return { ok: false, error: SIGN_IN };
  const result = await removeMessage(user, messageId);
  if (!result.ok) return result;
  if (result.byModerator && result.conversationId) await audit(user, "message.remove", { type: "conversation", id: result.conversationId }, { messageId });
  return { ok: true, data: undefined, message: "Message removed" };
}

/** Settings → messaging switches (administrators; shown on the moderation page). */
export async function saveMessagingSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change messaging settings." };
  const enabled = fdBool(formData, "enabled");
  const studentToStudent = fdBool(formData, "studentToStudent");
  const before = await mutate((db) => {
    const previous = { ...db.settings.messaging };
    db.settings.messaging = { ...db.settings.messaging, enabled, studentToStudent };
    db.settings.updatedAt = new Date().toISOString();
    return previous;
  });
  await audit(user, "settings.update", { type: "settings", id: "messaging" }, {
    section: "messaging",
    enabled,
    studentToStudent,
    changed: before.enabled !== enabled || before.studentToStudent !== studentToStudent,
  });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: enabled ? "Direct messages are on" : "Direct messages are off" };
}
