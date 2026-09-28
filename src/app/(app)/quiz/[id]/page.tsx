import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { getCourseById, getLessonById, getLessonHref } from "@/lib/data/courses";
import { getQuizAccess, getRunnerPayload, lessonUsesQuiz } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { Breadcrumbs, type Crumb } from "@/components/quiz/shared";

export async function generateMetadata(props: PageProps<"/quiz/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const quiz = await findById("quizzes", id);
  return { title: quiz ? quiz.title : "Quiz" };
}

export default async function QuizPage(props: PageProps<"/quiz/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const lessonParam = typeof sp.lesson === "string" ? sp.lesson : undefined;
  const courseParam = typeof sp.course === "string" ? sp.course : undefined;

  const qs = new URLSearchParams();
  if (lessonParam) qs.set("lesson", lessonParam);
  if (courseParam) qs.set("course", courseParam);
  const query = qs.toString();
  const user = await requireUser(`/quiz/${id}${query ? `?${query}` : ""}`);

  const quiz = await findById("quizzes", id);
  if (!quiz) notFound();

  // Optional lesson context (?lesson=&course=) for breadcrumbs and "Back to lesson".
  const lesson = lessonParam ? await getLessonById(lessonParam) : null;
  const validLesson = lesson && (lessonUsesQuiz(lesson, quiz.id) || quiz.lessonId === lesson.id) ? lesson : null;
  const lessonHref = validLesson ? await getLessonHref(validLesson.id) : null;
  const course = validLesson ? await getCourseById(validLesson.courseId) : courseParam ? await getCourseById(courseParam) : null;

  const access = await getQuizAccess(user, quiz);
  const manage = access.ok && access.manage;

  const crumbs: Crumb[] = [];
  if (validLesson && course) {
    crumbs.push({ label: "Courses", href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` });
    crumbs.push({ label: validLesson.title, href: lessonHref ?? undefined }, { label: quiz.title });
  } else if (manage) {
    crumbs.push({ label: "Quizzes", href: "/admin/quizzes" }, { label: quiz.title, href: `/admin/quizzes/${quiz.id}` }, { label: "Test Quiz" });
  } else if (course) {
    crumbs.push({ label: "Courses", href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` }, { label: quiz.title });
  } else {
    crumbs.push({ label: "Dashboard", href: "/dashboard" }, { label: quiz.title });
  }

  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader breadcrumbs={<Breadcrumbs items={crumbs} />} title={quiz.title} />
        <EmptyState
          icon={<Icon.Lock />}
          title={access.reason === "locked" ? "This quiz is locked" : "You can't take this quiz"}
          description={
            access.reason === "locked"
              ? access.message
              : "This quiz belongs to a course or batch you're not part of. Enroll to take it and track your score."
          }
          action={
            lessonHref ? (
              <ButtonLink href={lessonHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4" />}>
                Back to lesson
              </ButtonLink>
            ) : (
              <ButtonLink href={course ? `/courses/${course.slug}` : "/courses"}>{course ? "View course" : "Browse courses"}</ButtonLink>
            )
          }
        />
      </div>
    );
  }

  const payload = await getRunnerPayload(quiz, user, access.manage);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={quiz.title}
        description={payload.quiz.courseTitle && !validLesson ? payload.quiz.courseTitle : undefined}
        actions={
          <>
            {lessonHref && (
              <ButtonLink href={lessonHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
                Back to lesson
              </ButtonLink>
            )}
            {manage && (
              <>
                <ButtonLink href={`/admin/quizzes/submissions?quiz=${quiz.id}`} variant="subtle" size="sm" leftIcon={<Icon.ClipboardList className="size-4" />}>
                  Submissions
                </ButtonLink>
                <ButtonLink href={`/admin/quizzes/${quiz.id}`} variant="subtle" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                  Edit quiz
                </ButtonLink>
              </>
            )}
          </>
        }
      />
      {manage && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
          <Icon.Info className="mt-0.5 size-3.5 shrink-0" />
          You manage this quiz, so attempts you submit here are recorded like a learner&apos;s. Use Preview in the quiz builder to test without saving.
        </p>
      )}
      <QuizRunner
        payload={payload}
        lessonId={validLesson?.id}
        courseId={course?.id}
        backHref={lessonHref}
        backLabel="Back to lesson"
      />
    </div>
  );
}
