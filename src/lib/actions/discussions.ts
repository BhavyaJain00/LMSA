"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, DiscussionReply, DiscussionTopic, User } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { getLessonAccess, lessonHasQuiz, type LessonAccess } from "@/lib/data/lessons";
import { notifyMany } from "@/lib/services/notifications";
import { fd, truncate, uid } from "@/lib/utils";

/**
 * Lesson discussions (Frappe: Discussion Topic / Discussion Reply referencing
 * a Course Lesson). Only enrolled learners and course managers may read or
 * post. The first reply of a topic is the question body.
 */

const MAX_TITLE = 160;
const MAX_CONTENT = 10000;

type Gate = { ok: true; user: User; access: LessonAccess } | { ok: false; error: string };

async function gate(lessonId: string): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to join the discussion." };
  const access = lessonId ? await getLessonAccess(user, lessonId) : null;
  if (!access) return { ok: false, error: "This lesson no longer exists." };
  if (!access.settings.features.discussions) return { ok: false, error: "Discussions are turned off on this site." };
  if (!access.enrolled && !access.manager) return { ok: false, error: "You do not have access to this course." };
  if (!access.canView) return { ok: false, error: "You do not have access to this lesson." };
  if (lessonHasQuiz(access.lesson)) return { ok: false, error: "Discussions are closed on lessons with a quiz so answers stay private." };
  return { ok: true, user, access };
}

async function loadTopic(topicId: string): Promise<{ ok: true; topic: DiscussionTopic } | { ok: false; error: string }> {
  const db = await getDb();
  const topic = db.discussionTopics.find((t) => t.id === topicId && t.refType === "lesson");
  if (!topic) return { ok: false, error: "This question no longer exists." };
  return { ok: true, topic };
}

function topicLink(access: LessonAccess, topicId: string): string {
  return `${access.href}?tab=discussion&topic=${encodeURIComponent(topicId)}`;
}

function revalidateLessons(lessonHref?: string) {
  if (lessonHref) revalidatePath(lessonHref);
  revalidatePath("/(learn)/courses/[slug]/learn/[ref]", "page");
}

/** @username mentions that resolve to instructors of the course. */
async function mentionedInstructors(content: string, course: Course, exclude: string): Promise<string[]> {
  const handles = new Set<string>();
  for (const m of content.matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9._-]{0,63})/gi)) handles.add(m[2]!.toLowerCase().replace(/[._-]+$/, ""));
  if (!handles.size) return [];
  const db = await getDb();
  return db.users
    .filter((u) => u.enabled && handles.has(u.username.toLowerCase()) && course.instructorIds.includes(u.id) && u.id !== exclude)
    .map((u) => u.id);
}

/**
 * Notify people about new activity: mentioned instructors get a "mention",
 * the topic author and the remaining course instructors get a "reply".
 */
async function notifyParticipants(opts: {
  access: LessonAccess;
  topic: DiscussionTopic;
  author: User;
  content: string;
  isNewTopic: boolean;
}) {
  const { access, topic, author, content, isNewTopic } = opts;
  const link = topicLink(access, topic.id);
  const mentioned = await mentionedInstructors(content, access.course, author.id);
  if (mentioned.length) {
    await notifyMany(mentioned, {
      type: "mention",
      subject: `${author.name} mentioned you in a comment in ${topic.title}`,
      message: truncate(content.replace(/\s+/g, " "), 180),
      link,
      fromUserId: author.id,
    });
  }
  const recipients = new Set<string>(access.course.instructorIds);
  if (!isNewTopic) recipients.add(topic.authorId);
  recipients.delete(author.id);
  for (const id of mentioned) recipients.delete(id);
  if (recipients.size) {
    await notifyMany(Array.from(recipients), {
      type: "reply",
      subject: isNewTopic
        ? `New question in ${access.course.title}: ${topic.title}`
        : `New reply on the topic ${topic.title} in course ${access.course.title}`,
      message: truncate(content.replace(/\s+/g, " "), 180),
      link,
      fromUserId: author.id,
    });
  }
}

/** Ask a new question on a lesson. Fields: lessonId, title, content. Returns the topic id. */
export async function createTopicAction(_prev: ActionResult<{ topicId: string }> | null, formData: FormData): Promise<ActionResult<{ topicId: string }>> {
  const lessonId = fd(formData, "lessonId");
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const content = fd(formData, "content");

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Title cannot be empty.";
  else if (title.length > MAX_TITLE) fieldErrors.title = `Keep the title under ${MAX_TITLE} characters.`;
  if (!content) fieldErrors.content = "Details cannot be empty.";
  else if (content.length > MAX_CONTENT) fieldErrors.content = `Details can be at most ${MAX_CONTENT.toLocaleString()} characters.`;
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const g = await gate(lessonId);
  if (!g.ok) return g;

  const now = new Date().toISOString();
  const topic: DiscussionTopic = {
    id: uid("dt"),
    refType: "lesson",
    refId: g.access.lesson.id,
    courseId: g.access.course.id,
    authorId: g.user.id,
    title,
    createdAt: now,
    updatedAt: now,
  };
  const reply: DiscussionReply = { id: uid("dr"), topicId: topic.id, authorId: g.user.id, content, createdAt: now, updatedAt: now };
  await mutate((db) => {
    db.discussionTopics.push(topic);
    db.discussionReplies.push(reply);
  });
  await notifyParticipants({ access: g.access, topic, author: g.user, content, isNewTopic: true });
  revalidateLessons(g.access.href);
  return { ok: true, data: { topicId: topic.id }, message: "Question posted" };
}

/** Reply to a question. Fields: topicId, content. */
export async function createReplyAction(_prev: ActionResult<{ replyId: string }> | null, formData: FormData): Promise<ActionResult<{ replyId: string }>> {
  const topicId = fd(formData, "topicId");
  const content = fd(formData, "content");
  if (!content) return { ok: false, error: "Reply cannot be empty.", fieldErrors: { content: "Reply cannot be empty." } };
  if (content.length > MAX_CONTENT) {
    return { ok: false, error: "Your reply is too long.", fieldErrors: { content: `Replies can be at most ${MAX_CONTENT.toLocaleString()} characters.` } };
  }

  const loaded = await loadTopic(topicId);
  if (!loaded.ok) return loaded;
  const g = await gate(loaded.topic.refId);
  if (!g.ok) return g;

  const now = new Date().toISOString();
  const reply: DiscussionReply = { id: uid("dr"), topicId: loaded.topic.id, authorId: g.user.id, content, createdAt: now, updatedAt: now };
  await mutate((db) => {
    db.discussionReplies.push(reply);
    const topic = db.discussionTopics.find((t) => t.id === loaded.topic.id);
    if (topic) topic.updatedAt = now;
  });
  await notifyParticipants({ access: g.access, topic: loaded.topic, author: g.user, content, isNewTopic: false });
  revalidateLessons(g.access.href);
  return { ok: true, data: { replyId: reply.id }, message: "Reply posted" };
}

/** Edit one of your replies. Fields: replyId, content. */
export async function updateReplyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const replyId = fd(formData, "replyId");
  const content = fd(formData, "content");
  if (!content) return { ok: false, error: "Reply cannot be empty.", fieldErrors: { content: "Reply cannot be empty." } };
  if (content.length > MAX_CONTENT) {
    return { ok: false, error: "Your reply is too long.", fieldErrors: { content: `Replies can be at most ${MAX_CONTENT.toLocaleString()} characters.` } };
  }

  const db = await getDb();
  const reply = db.discussionReplies.find((r) => r.id === replyId);
  if (!reply) return { ok: false, error: "This reply no longer exists." };
  const loaded = await loadTopic(reply.topicId);
  if (!loaded.ok) return loaded;
  const g = await gate(loaded.topic.refId);
  if (!g.ok) return g;
  if (reply.authorId !== g.user.id) return { ok: false, error: "You can only edit your own replies." };

  await mutate((d) => {
    const row = d.discussionReplies.find((r) => r.id === reply.id);
    if (row) {
      row.content = content;
      row.updatedAt = new Date().toISOString();
    }
  });
  revalidateLessons(g.access.href);
  return { ok: true, data: undefined, message: "Reply updated" };
}

/** Rename one of your questions. Fields: topicId, title. */
export async function updateTopicAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const topicId = fd(formData, "topicId");
  const title = fd(formData, "title").replace(/\s+/g, " ");
  if (!title) return { ok: false, error: "Title cannot be empty.", fieldErrors: { title: "Title cannot be empty." } };
  if (title.length > MAX_TITLE) return { ok: false, error: "The title is too long.", fieldErrors: { title: `Keep the title under ${MAX_TITLE} characters.` } };

  const loaded = await loadTopic(topicId);
  if (!loaded.ok) return loaded;
  const g = await gate(loaded.topic.refId);
  if (!g.ok) return g;
  if (loaded.topic.authorId !== g.user.id) return { ok: false, error: "You can only edit your own questions." };

  await mutate((d) => {
    const row = d.discussionTopics.find((t) => t.id === loaded.topic.id);
    if (row) row.title = title;
  });
  revalidateLessons(g.access.href);
  return { ok: true, data: undefined, message: "Question updated" };
}

/**
 * Delete a reply. Authors can delete their own replies; course managers can
 * delete any. Deleting the opening post removes the whole question.
 */
export async function deleteReplyAction(replyId: string): Promise<ActionResult<{ topicDeleted: boolean }>> {
  const db = await getDb();
  const reply = db.discussionReplies.find((r) => r.id === replyId);
  if (!reply) return { ok: false, error: "This reply no longer exists." };
  const loaded = await loadTopic(reply.topicId);
  if (!loaded.ok) return loaded;
  const g = await gate(loaded.topic.refId);
  if (!g.ok) return g;
  if (reply.authorId !== g.user.id && !g.access.manager) return { ok: false, error: "You can only delete your own replies." };

  const first = db.discussionReplies
    .filter((r) => r.topicId === reply.topicId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const topicDeleted = first?.id === reply.id;

  await mutate((d) => {
    if (topicDeleted) {
      d.discussionTopics = d.discussionTopics.filter((t) => t.id !== reply.topicId);
      d.discussionReplies = d.discussionReplies.filter((r) => r.topicId !== reply.topicId);
    } else {
      d.discussionReplies = d.discussionReplies.filter((r) => r.id !== reply.id);
    }
  });
  revalidateLessons(g.access.href);
  return { ok: true, data: { topicDeleted }, message: topicDeleted ? "Question deleted" : "Reply deleted" };
}

/** Delete a whole question with its replies (author or course manager). */
export async function deleteTopicAction(topicId: string): Promise<ActionResult> {
  const loaded = await loadTopic(typeof topicId === "string" ? topicId : "");
  if (!loaded.ok) return loaded;
  const g = await gate(loaded.topic.refId);
  if (!g.ok) return g;
  if (loaded.topic.authorId !== g.user.id && !g.access.manager) return { ok: false, error: "You can only delete your own questions." };

  await mutate((d) => {
    d.discussionTopics = d.discussionTopics.filter((t) => t.id !== loaded.topic.id);
    d.discussionReplies = d.discussionReplies.filter((r) => r.topicId !== loaded.topic.id);
  });
  revalidateLessons(g.access.href);
  return { ok: true, data: undefined, message: "Question deleted" };
}
