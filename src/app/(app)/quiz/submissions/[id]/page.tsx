import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { getSubmissionDetail } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, type Crumb } from "@/components/quiz/shared";
import { SubmissionDetailView } from "@/components/quiz/submission-detail";
import { LocalTime } from "@/components/quiz/local-time";
import { getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/quiz/submissions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const [user, t] = await Promise.all([getCurrentUser(), getT("learning")]);
  const data = user ? await getSubmissionDetail(user, id) : null;
  return { title: data ? t("quiz.submission.metaTitle", { title: data.quiz?.title ?? data.submission.quizTitle }) : t("quiz.submission.metaFallback") };
}

export default async function QuizSubmissionPage(props: PageProps<"/quiz/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/quiz/submissions/${id}`);
  const [data, t] = await Promise.all([getSubmissionDetail(user, id), getT("learning")]);
  if (!data) notFound();

  const { submission: s, quiz, course } = data;
  const title = quiz?.title ?? s.quizTitle;
  const crumbs: Crumb[] = [];
  if (!data.isOwn && data.canManage) {
    crumbs.push({ label: t("quiz.page.crumbQuizzes"), href: "/admin/quizzes" }, { label: t("quiz.page.submissions"), href: "/admin/quizzes/submissions" });
    crumbs.push({ label: data.learner?.name ?? s.id });
  } else if (course) {
    crumbs.push({ label: t("quiz.page.crumbCourses"), href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` });
    if (quiz) crumbs.push({ label: title, href: `/quiz/${quiz.id}` });
    crumbs.push({ label: t("quiz.submission.attempt", { number: data.attemptNumber }) });
  } else {
    crumbs.push({ label: t("quiz.page.crumbDashboard"), href: "/dashboard" });
    if (quiz) crumbs.push({ label: title, href: `/quiz/${quiz.id}` });
    crumbs.push({ label: t("quiz.submission.attempt", { number: data.attemptNumber }) });
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={data.isOwn ? t("quiz.submission.yourAttempt", { number: data.attemptNumber }) : title}
        description={t.rich("quiz.submission.submittedBy", {
          name: data.isOwn ? title : (data.learner?.name ?? t("quiz.submission.learner")),
          time: <LocalTime iso={s.submittedAt} />,
        })}
        actions={
          <>
            {data.lessonHref && (
              <ButtonLink href={data.lessonHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {t("quiz.results.backToLesson")}
              </ButtonLink>
            )}
            {data.isOwn && quiz && !data.lessonHref && (
              <ButtonLink href={`/quiz/${quiz.id}`} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {t("quiz.detail.backToQuiz")}
              </ButtonLink>
            )}
            {data.canManage && !data.isOwn && (
              <ButtonLink href={`/admin/quizzes/submissions/${s.id}`} variant="subtle" size="sm" leftIcon={<Icon.ClipboardList className="size-4" />}>
                {t("quiz.submission.openInAdmin")}
              </ButtonLink>
            )}
          </>
        }
      />
      <SubmissionDetailView data={data} context={data.isOwn ? "learner" : "admin"} />
    </div>
  );
}
