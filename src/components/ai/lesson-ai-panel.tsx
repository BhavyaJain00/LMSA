import "server-only";
import type { ReactNode } from "react";
import type { Course, Lesson, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { courseTutorAccess } from "@/lib/ai/access";
import { learnerQuota, toQuotaView } from "@/lib/ai/chat";
import { conversationMessages, lessonLinks, toConversationSummary, toMessageView } from "@/lib/ai/service";
import { lessonStarterQuestions } from "@/lib/ai/starters";
import { AiTutorPanel } from "./ai-tutor-panel";

/**
 * The "Ask AI" sidebar panel for a lesson page, or null when the tutor isn't
 * available to this viewer (not configured, turned off for the course, not
 * enrolled). Reopening a lesson shows the learner's latest conversation about it.
 */
export async function getLessonAiPanel({ course, lesson, viewer }: { course: Course; lesson: Pick<Lesson, "id" | "title" | "blocks">; viewer: User | null }): Promise<ReactNode | null> {
  if (!viewer) return null;
  const db = await getDb();
  const access = courseTutorAccess(db, course, viewer);
  if (!access.ok) return null;

  const links = lessonLinks(db, course);
  const latest = db.aiConversations
    .filter((c) => c.userId === viewer.id && c.courseId === course.id && c.lessonId === lesson.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const messages = latest ? conversationMessages(db, latest.id) : [];

  return (
    <AiTutorPanel
      courseId={course.id}
      courseSlug={course.slug}
      courseTitle={course.title}
      lessonId={lesson.id}
      starterQuestions={lessonStarterQuestions(lesson, course.title)}
      initialConversation={latest ? toConversationSummary(latest, messages.length, links) : null}
      initialMessages={messages.map((m) => toMessageView(m, links))}
      initialQuota={toQuotaView(learnerQuota(db, viewer.id, access.manager))}
    />
  );
}
