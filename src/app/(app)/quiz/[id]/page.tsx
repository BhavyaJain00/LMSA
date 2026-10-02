import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { getCourseById, getLessonById, getLessonHref } from "@/lib/data/courses";
import { getLessonAccess } from "@/lib/data/lessons";
import { getQuizAccess, getRunnerPayload, lessonUsesQuiz } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { Breadcrumbs, type Crumb } from "@/components/quiz/shared";
import { getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/quiz/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const [quiz, t] = await Promise.all([findById("quizzes", id), getT("learning")]);
  return { title: quiz ? quiz.title : t("quiz.page.metaTitle") };
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

  const [quiz, t] = await Promise.all([findById("quizzes", id), getT("learning")]);
  if (!quiz) notFound();

  const access = await getQuizAccess(user, quiz);
  const manage = access.ok && access.manage;

  // Optional lesson context (?lesson=&course=) for breadcrumbs, "Back to lesson" and tying the
  // attempt to the lesson. It only counts for a lesson that embeds the quiz and that the viewer
  // can open right now (not locked by a drip schedule, the lesson order or prerequisites).
  const lesson = lessonParam ? await getLessonById(lessonParam) : null;
  const embedsQuiz = !!lesson && (lessonUsesQuiz(lesson, quiz.id) || quiz.lessonId === lesson.id);
  const validLesson = embedsQuiz && (manage || (await getLessonAccess(user, lesson.id))?.canView) ? lesson : null;
  const lessonHref = validLesson ? await getLessonHref(validLesson.id) : null;
  const course = validLesson ? await getCourseById(validLesson.courseId) : courseParam ? await getCourseById(courseParam) : null;

  const crumbs: Crumb[] = [];
  if (validLesson && course) {
    crumbs.push({ label: t("quiz.page.crumbCourses"), href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` });
    crumbs.push({ label: validLesson.title, href: lessonHref ?? undefined }, { label: quiz.title });
  } else if (manage) {
    crumbs.push(
      { label: t("quiz.page.crumbQuizzes"), href: "/admin/quizzes" },
      { label: quiz.title, href: `/admin/quizzes/${quiz.id}` },
      { label: t("quiz.page.crumbTest") },
    );
  } else if (course) {
    crumbs.push({ label: t("quiz.page.crumbCourses"), href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` }, { label: quiz.title });
  } else {
    crumbs.push({ label: t("quiz.page.crumbDashboard"), href: "/dashboard" }, { label: quiz.title });
  }

  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader breadcrumbs={<Breadcrumbs items={crumbs} />} title={quiz.title} />
        <EmptyState
          icon={<Icon.Lock />}
          title={access.reason === "locked" ? t("quiz.block.lockedTitle") : t("quiz.page.noAccessTitle")}
          description={access.reason === "locked" ? access.message : t("quiz.page.noAccessBody")}
          action={
            lessonHref ? (
              <ButtonLink href={lessonHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {t("quiz.results.backToLesson")}
              </ButtonLink>
            ) : (
              <ButtonLink href={course ? `/courses/${course.slug}` : "/courses"}>{course ? t("quiz.page.viewCourse") : t("quiz.page.browseCourses")}</ButtonLink>
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
              <ButtonLink href={lessonHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {t("quiz.results.backToLesson")}
              </ButtonLink>
            )}
            {manage && (
              <>
                <ButtonLink href={`/admin/quizzes/submissions?quiz=${quiz.id}`} variant="subtle" size="sm" leftIcon={<Icon.ClipboardList className="size-4" />}>
                  {t("quiz.page.submissions")}
                </ButtonLink>
                <ButtonLink href={`/admin/quizzes/${quiz.id}`} variant="subtle" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                  {t("quiz.page.editQuiz")}
                </ButtonLink>
              </>
            )}
          </>
        }
      />
      {manage && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
          <Icon.Info className="mt-0.5 size-3.5 shrink-0" />
          {t("quiz.page.managerNote")}
        </p>
      )}
      <QuizRunner
        payload={payload}
        lessonId={validLesson?.id}
        courseId={course?.id}
        backHref={lessonHref}
        backLabel={t("quiz.results.backToLesson")}
      />
    </div>
  );
}
