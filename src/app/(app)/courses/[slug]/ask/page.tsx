import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getCourseBySlug } from "@/lib/data/courses";
import { courseTutorAccess, unavailableMessage } from "@/lib/ai/access";
import { learnerQuota, toQuotaView } from "@/lib/ai/chat";
import { readableLessonIds } from "@/lib/ai/course-index";
import { listConversations, loadOwnConversation, lessonLinks } from "@/lib/ai/service";
import { lessonStarterQuestions } from "@/lib/ai/starters";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { AiSetupNotice } from "@/components/ai/setup-notice";
import { AskAiWorkspace } from "@/components/ai/ask-ai-workspace";

export async function generateMetadata(props: PageProps<"/courses/[slug]/ask">): Promise<Metadata> {
  const { slug } = await props.params;
  const course = await getCourseBySlug(slug);
  return { title: course ? `Ask AI · ${course.title}` : "Ask AI", robots: { index: false, follow: false } };
}

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[\w-]{1,64}$/.test(v) ? v : null;
}

export default async function AskAiPage(props: PageProps<"/courses/[slug]/ask">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(`/courses/${slug}/ask`);
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const db = await getDb();
  const access = courseTutorAccess(db, course, user);
  const courseHref = `/courses/${course.slug}`;

  if (!access.ok) {
    const setup = access.reason === "site_disabled" || access.reason === "no_key" || access.reason === "course_disabled";
    // Learners never see a tutor that isn't set up; staff get the setup steps instead.
    if (access.reason === "not_found" || (setup && !access.manager)) notFound();
    return (
      <div className="mx-auto max-w-2xl py-6">
        <Link href={courseHref} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <Icon.ArrowLeft className="size-4" /> {course.title}
        </Link>
        {setup ? (
          <AiSetupNotice
            reason={access.reason as "site_disabled" | "no_key" | "course_disabled"}
            isAdmin={isAdmin(user)}
            courseSettingsHref={`/admin/courses/${course.id}?tab=settings`}
          />
        ) : (
          <EmptyState
            icon={<Icon.Sparkles />}
            title="Ask the AI tutor"
            description={unavailableMessage(access.reason)}
            action={
              <ButtonLink href={courseHref} leftIcon={<Icon.BookOpen className="size-4" />}>
                View the course
              </ButtonLink>
            }
          />
        )}
      </div>
    );
  }

  const links = lessonLinks(db, course);
  const readable = readableLessonIds(db, course, user);
  const own = first(sp.c) ? loadOwnConversation(db, first(sp.c)!, user.id) : null;
  const active = own && own.course.id === course.id ? own : null;

  const requestedLesson = first(sp.lesson) ?? active?.conversation.lessonId ?? null;
  const lesson = requestedLesson ? db.lessons.find((l) => l.id === requestedLesson && l.courseId === course.id && (!readable || readable.has(l.id))) : undefined;
  const lessonLink = lesson ? links.get(lesson.id) : undefined;
  const conversations = listConversations(db, user.id, course);

  return (
    <AskAiWorkspace
      courseId={course.id}
      courseTitle={course.title}
      courseHref={courseHref}
      lesson={lesson && lessonLink ? { id: lesson.id, title: lesson.title, href: lessonLink.href } : null}
      starterQuestions={lessonStarterQuestions(lesson ?? null, course.title)}
      conversations={conversations}
      initialConversation={active ? (conversations.find((c) => c.id === active.conversation.id) ?? null) : null}
      initialMessages={active?.messages ?? []}
      initialQuota={toQuotaView(learnerQuota(db, user.id, access.manager))}
    />
  );
}
