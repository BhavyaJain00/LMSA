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

export async function generateMetadata(props: PageProps<"/quiz/submissions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const data = user ? await getSubmissionDetail(user, id) : null;
  return { title: data ? `${data.quiz?.title ?? data.submission.quizTitle} · Submission` : "Quiz Submission" };
}

export default async function QuizSubmissionPage(props: PageProps<"/quiz/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/quiz/submissions/${id}`);
  const data = await getSubmissionDetail(user, id);
  if (!data) notFound();

  const { submission: s, quiz, course } = data;
  const title = quiz?.title ?? s.quizTitle;
  const crumbs: Crumb[] = [];
  if (!data.isOwn && data.canManage) {
    crumbs.push({ label: "Quizzes", href: "/admin/quizzes" }, { label: "Submissions", href: "/admin/quizzes/submissions" });
    crumbs.push({ label: data.learner?.name ?? s.id });
  } else if (course) {
    crumbs.push({ label: "Courses", href: "/courses" }, { label: course.title, href: `/courses/${course.slug}` });
    if (quiz) crumbs.push({ label: title, href: `/quiz/${quiz.id}` });
    crumbs.push({ label: `Attempt ${data.attemptNumber}` });
  } else {
    crumbs.push({ label: "Dashboard", href: "/dashboard" });
    if (quiz) crumbs.push({ label: title, href: `/quiz/${quiz.id}` });
    crumbs.push({ label: `Attempt ${data.attemptNumber}` });
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={data.isOwn ? `Your attempt ${data.attemptNumber}` : title}
        description={
          <>
            {data.isOwn ? `${title} · submitted ` : `${data.learner?.name ?? "Learner"} · submitted `}
            <LocalTime iso={s.submittedAt} />
          </>
        }
        actions={
          <>
            {data.lessonHref && (
              <ButtonLink href={data.lessonHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
                Back to lesson
              </ButtonLink>
            )}
            {data.isOwn && quiz && !data.lessonHref && (
              <ButtonLink href={`/quiz/${quiz.id}`} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
                Back to quiz
              </ButtonLink>
            )}
            {data.canManage && !data.isOwn && (
              <ButtonLink href={`/admin/quizzes/submissions/${s.id}`} variant="subtle" size="sm" leftIcon={<Icon.ClipboardList className="size-4" />}>
                Open in admin
              </ButtonLink>
            )}
          </>
        }
      />
      <SubmissionDetailView data={data} context={data.isOwn ? "learner" : "admin"} />
    </div>
  );
}
